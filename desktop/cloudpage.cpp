#include "cloudpage.h"
#include "githubcloud.h"
#include "store.h"

#include <QApplication>
#include <QCheckBox>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFormLayout>
#include <QFutureWatcher>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QLockFile>
#include <QDialog>
#include <QDialogButtonBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSaveFile>
#include <QTimer>
#include <QVBoxLayout>
#include <QtConcurrent/QtConcurrentRun>
#include <stdexcept>
#ifdef Q_OS_WIN
#include <windows.h>
#include <wincrypt.h>
#endif

namespace {
using namespace Cloud;
[[noreturn]] void fail(const QString &message) { throw std::runtime_error(message.toStdString()); }

QByteArray protect(QByteArray value, bool encrypt) {
#ifdef Q_OS_WIN
    DATA_BLOB input{DWORD(value.size()), reinterpret_cast<BYTE *>(value.data())}, output{};
    const bool ok = encrypt
        ? CryptProtectData(&input, L"DailyRule GitHub sync", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)
        : CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output);
    if (!ok) fail("Windows 无法打开此账户的同步凭据，请重新填写令牌。");
    QByteArray result(reinterpret_cast<const char *>(output.pbData), int(output.cbData));
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return result;
#else
    Q_UNUSED(value)
    Q_UNUSED(encrypt)
    fail("当前桌面包缺少系统凭据保险库。");
#endif
}

QJsonObject settings(const QString &path) {
    QFile file(path);
    if (!file.exists()) return {};
    if (!file.open(QIODevice::ReadOnly)) fail("无法读取本机同步设置。");
    const auto doc = QJsonDocument::fromJson(file.readAll());
    if (file.error() != QFile::NoError || !doc.isObject()) fail("同步设置文件有误，请检查本机档案目录。");
    return doc.object();
}
void saveSettings(const QString &path, const QJsonObject &data) {
    if (!QDir().mkpath(QFileInfo(path).absolutePath())) fail("无法创建同步设置目录。");
    QSaveFile file(path);
    const auto bytes = QJsonDocument(data).toJson(QJsonDocument::Compact);
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit()) fail("无法保存本机同步设置。");
}
void lockSession(QLockFile &lock) {
    lock.setStaleLockTime(0);
    if (!lock.tryLock()) fail("另一窗口正在同步。请稍后再试。");
}

QString summary(const QJsonObject &state) {
    int active = 0, history = 0, reviews = 0;
    for (const auto &value : state.value("rules").toArray()) {
        const auto rule = value.toObject();
        if (rule.value("archivedAt").isNull()) ++active; else ++history;
        if (rule.value("review").isObject()) ++reviews;
    }
    return QString("%1 个类别，%2 项生效，%3 项归档，%4 份复盘")
        .arg(state.value("categories").toArray().size()).arg(active).arg(history).arg(reviews);
}

Direction chooseArchive(QWidget *parent, const Preview &preview) {
    QDialog dialog(parent);
    dialog.setWindowTitle("核对同步方向");
    dialog.setMinimumWidth(440);
    auto *layout = new QVBoxLayout(&dialog);
    auto addText = [&](const QString &text) {
        auto *label = new QLabel;
        label->setTextFormat(Qt::PlainText);
        label->setWordWrap(true);
        label->setText(text);
        layout->addWidget(label);
    };
    const bool exists = !preview.remote.revision.isEmpty();
    addText("本机：" + summary(preview.local) + "\n云端：" +
            (exists ? summary(preview.remote.state) : QString("尚无档案")));
    if (exists) {
        const auto diff = archiveDifferences(preview.local, preview.remote.state);
        if (diff.count > 0) {
            addText(QString("共 %1 处差异\n• ").arg(diff.count) + diff.highlights.join("\n• "));
            auto *toggle = new QPushButton("查看差异明细");
            toggle->setCheckable(true);
            toggle->setAutoDefault(false);
            layout->addWidget(toggle, 0, Qt::AlignLeft);
            auto *details = new QPlainTextEdit;
            details->setReadOnly(true);
            details->setAccessibleName("差异明细");
            details->setFixedHeight(170);
            QString report = diff.details.join("\n\n");
            if (diff.count > diff.details.size()) report += QString("\n\n此处列出前 %1 处。").arg(diff.details.size());
            details->setPlainText(report);
            layout->addWidget(details);
            details->hide();
            QObject::connect(toggle, &QPushButton::toggled, &dialog, [&, toggle, details](bool open) {
                details->setVisible(open);
                toggle->setText(open ? "收起明细" : "查看差异明细");
                dialog.adjustSize();
            });
        } else {
            addText("两份档案的扩展字段存在差异。");
        }
    }
    addText("请选择作为当前版本的整份档案。下载会给被替换的本机档案留一份恢复副本，上传会生成新的云端版本。");
    auto *actions = new QDialogButtonBox;
    auto *cancel = actions->addButton("暂不同步", QDialogButtonBox::RejectRole);
    cancel->setDefault(true);
    QObject::connect(cancel, &QPushButton::clicked, &dialog, &QDialog::reject);
    Direction decision = Direction::Choose;
    auto choice = [&](const QString &caption, Direction direction) {
        auto *button = actions->addButton(caption, QDialogButtonBox::ActionRole);
        button->setAutoDefault(false);
        QObject::connect(button, &QPushButton::clicked, &dialog, [&, direction] {
            decision = direction;
            dialog.accept();
        });
    };
    if (exists) choice("使用云端档案", Direction::Download);
    choice("使用本机档案", Direction::Upload);
    layout->addWidget(actions);
    dialog.exec();
    return decision;
}

struct Result {
    QString message;
    bool prompt = false;
    bool downloaded = false;
    Preview preview;
};
Result synchronize(const QString &path, const QString &archive, bool automatic, Direction choice, const Preview &expected,
                   const QString &expectedRepo) {
    try {
        QLockFile lock(path + ".lock");
        lockSession(lock);
        auto config = settings(path);
        if (config.value("repository").toString() != expectedRepo || config.value("credential").toString().isEmpty())
            fail("同步账户已调整，请重新打开应用以使用最新设置。");
        if (automatic && !config.value("automatic").toBool()) return {"自动同步已关闭。"};
        const auto secret = protect(QByteArray::fromBase64(config.value("credential").toString().toLatin1()), false);
        GitHubRemote remote(expectedRepo, secret);
        Store store(archive);
        const auto preview = inspect(store, remote, {config.value("hash").toString(), config.value("revision").toString()});
        Direction direction = preview.direction;
        if (choice != Direction::Choose) {
            if (preview.local != expected.local || preview.remote.revision != expected.remote.revision || preview.remote.state != expected.remote.state)
                fail("预览后档案已有改动，请重新同步后核对。");
            direction = choice;
        } else if (direction == Direction::Choose) {
            return {"需要核对同步方向，请点「立即同步」。", !automatic, false, preview};
        }
        const auto base = apply(store, remote, preview, direction);
        if (config.value("hash") != base.hash || config.value("revision") != base.revision) {
            config["hash"] = base.hash;
            config["revision"] = base.revision;
            saveSettings(path, config);
        }
        QString action = direction == Direction::Upload ? "本机档案已上传" :
                         direction == Direction::Download ? "已从云端更新本机档案" : "本机与云端档案一致";
        return {action + " · " + QDateTime::currentDateTime().toString("MM-dd HH:mm"), false, direction == Direction::Download};
    } catch (const std::exception &e) {
        return {QString::fromUtf8(e.what())};
    }
}
}

CloudPage::CloudPage(Store &store, std::function<void()> changed, QWidget *parent)
    : QWidget(parent), settingsPath(store.filePath() + ".sync.json"), archivePath(store.filePath()), changed(std::move(changed)) {
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(25, 22, 25, 22);
    auto *title = new QLabel("跨设备同步");
    auto font = title->font();
    font.setPointSize(20);
    font.setBold(true);
    title->setFont(font);
    layout->addWidget(title);
    auto *help = new QLabel("手机和电脑使用同一个专用 GitHub 私有仓库。细粒度令牌只需授权这个仓库的 Contents 读写权限。");
    help->setWordWrap(true);
    layout->addWidget(help);
    auto *form = new QFormLayout;
    repository = new QLineEdit;
    repository->setText("yinHuanSha/daily_rule_sync");
    token = new QLineEdit;
    token->setEchoMode(QLineEdit::Password);
    token->setPlaceholderText("GitHub 细粒度访问令牌");
    form->addRow("私有仓库", repository);
    form->addRow("访问令牌", token);
    layout->addLayout(form);
    automaticBox = new QCheckBox("应用运行时每分钟自动同步");
    layout->addWidget(automaticBox);
    auto *buttons = new QHBoxLayout;
    save = new QPushButton("保存设置");
    sync = new QPushButton("立即同步");
    disconnect = new QPushButton("断开同步");
    for (auto *button : {save, sync, disconnect}) buttons->addWidget(button);
    buttons->addStretch();
    layout->addLayout(buttons);
    status = new QLabel("首次同步会列出本机与云端的档案数量，由你选择同步方向。");
    status->setTextFormat(Qt::PlainText);
    status->setWordWrap(true);
    layout->addWidget(status);
    layout->addStretch();
    try {
        auto config = settings(settingsPath);
        savedRepo = config.value("repository").toString();
        connected = !savedRepo.isEmpty() && !config.value("credential").toString().isEmpty();
        if (connected) {
            repository->setText(savedRepo);
            token->setPlaceholderText("已由 Windows 加密保存，留空可沿用");
        }
        savedAuto = config.value("automatic").toBool();
        automaticBox->setChecked(savedAuto);
    } catch (const std::exception &e) { status->setText(QString::fromUtf8(e.what())); }

    connect(save, &QPushButton::clicked, this, [this] { configure(); });
    connect(sync, &QPushButton::clicked, this, [this] { run(false); });
    connect(repository, &QLineEdit::textChanged, this, [this] { updateButtons(); });
    connect(token, &QLineEdit::textChanged, this, [this] { updateButtons(); });
    connect(automaticBox, &QCheckBox::toggled, this, [this] { updateButtons(); });
    connect(disconnect, &QPushButton::clicked, this, [this] {
        try {
            QLockFile lock(settingsPath + ".lock");
            lockSession(lock);
            if (QFile::exists(settingsPath) && !QFile::remove(settingsPath)) fail("清除本机同步设置失败。");
            savedRepo.clear();
            savedAuto = connected = false;
            token->clear();
            automaticBox->setChecked(false);
            token->setPlaceholderText("GitHub 细粒度访问令牌");
            status->setText("已清除本机令牌和同步设置。");
            updateButtons();
        } catch (const std::exception &e) { status->setText(QString::fromUtf8(e.what())); }
    });
    auto *timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, [this] {
        if (savedAuto && sync->isEnabled() && !QApplication::activeModalWidget()) run(true);
    });
    timer->start(60000);
    updateButtons();
}

void CloudPage::configure() {
    try {
        const auto name = Cloud::normalizeRepository(repository->text());
        QLockFile lock(settingsPath + ".lock");
        lockSession(lock);
        auto config = settings(settingsPath);
        const bool changedRepo = name != config.value("repository").toString();
        if (changedRepo) config = {};
        const auto secret = token->text().trimmed().toUtf8();
        if (!secret.isEmpty()) {
            if (secret.contains('\r') || secret.contains('\n')) fail("访问令牌格式有误。");
            config["credential"] = QString::fromLatin1(protect(secret, true).toBase64());
        }
        if (config.value("credential").toString().isEmpty()) fail("请填写这个私有仓库的访问令牌。");
        config["repository"] = name;
        config["automatic"] = automaticBox->isChecked();
        saveSettings(settingsPath, config);
        savedRepo = name;
        connected = true;
        savedAuto = automaticBox->isChecked();
        repository->setText(name);
        token->clear();
        token->setPlaceholderText("已由 Windows 加密保存，留空可沿用");
        status->setText("设置已保存，点「立即同步」连接私有仓库。");
        updateButtons();
    } catch (const std::exception &e) { status->setText(QString::fromUtf8(e.what())); }
}

void CloudPage::updateButtons() {
    const bool dirty = repository->text().trimmed().toLower() != savedRepo || !token->text().isEmpty() ||
                       automaticBox->isChecked() != savedAuto;
    for (QWidget *widget : QList<QWidget *>{repository, token, automaticBox}) widget->setEnabled(!working);
    sync->setEnabled(!working && connected && !dirty);
    disconnect->setEnabled(!working && connected);
    save->setEnabled(!working && dirty);
}

void CloudPage::run(bool automatic, Cloud::Direction choice, Cloud::Preview expected) {
    if (working) return;
    working = true;
    status->setText("正在与专用私有仓库核对版本…");
    updateButtons();
    auto *watch = new QFutureWatcher<Result>(this);
    connect(watch, &QFutureWatcher<Result>::finished, this, [this, watch] {
        const auto result = watch->result();
        watch->deleteLater();
        working = false;
        updateButtons();
        status->setText(result.message);
        if (result.downloaded) changed();
        if (!result.prompt) return;
        const auto &preview = result.preview;
        const auto choice = chooseArchive(this, preview);
        if (choice != Cloud::Direction::Choose) run(false, choice, preview);
    });
    watch->setFuture(QtConcurrent::run([path=settingsPath, file=archivePath, repo=savedRepo, automatic, choice, expected] {
        return synchronize(path, file, automatic, choice, expected, repo);
    }));
}
