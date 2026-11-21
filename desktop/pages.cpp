#include "pages.h"
#include "store.h"

#include <QDateTime>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QFrame>
#include <QHash>
#include <QIcon>
#include <QInputDialog>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QListWidget>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSaveFile>
#include <QScrollArea>
#include <QSplitter>
#include <QStandardPaths>
#include <QUrl>
#include <QVBoxLayout>
#include <algorithm>
#include <stdexcept>

namespace {
QLabel *label(const QString &text, int pointSize = 0) {
    auto *result = new QLabel;
    result->setTextFormat(Qt::PlainText);
    result->setWordWrap(true);
    result->setText(text);
    if (pointSize) {
        QFont font = result->font();
        font.setPointSize(pointSize);
        font.setBold(true);
        result->setFont(font);
    }
    return result;
}

QVBoxLayout *pageLayout(QWidget *page, const QString &title) {
    auto *layout = new QVBoxLayout(page);
    layout->setContentsMargins(24, 20, 24, 20);
    layout->setSpacing(12);
    layout->addWidget(label(title, 20));
    return layout;
}

QVBoxLayout *card(QVBoxLayout *parent, const QString &title) {
    auto *frame = new QFrame;
    frame->setObjectName("detailCard");
    frame->setStyleSheet("QFrame#detailCard {background: #fffdf6; border: 1px solid #d4d4bf; border-radius: 8px;}");
    auto *layout = new QVBoxLayout(frame);
    layout->setContentsMargins(16, 13, 16, 13);
    layout->setSpacing(8);
    layout->addWidget(label(title, 12));
    parent->addWidget(frame);
    return layout;
}

QWidget *scrollPage(QWidget *body) {
    auto *scroll = new QScrollArea;
    scroll->setWidgetResizable(true);
    scroll->setFrameShape(QFrame::NoFrame);
    scroll->setWidget(body);
    return scroll;
}

void showError(QWidget *parent, const std::exception &ex) {
    QMessageBox msg(QMessageBox::Warning, "操作未完成", QString::fromUtf8(ex.what()), QMessageBox::Ok, parent);
    msg.setTextFormat(Qt::PlainText);
    msg.exec();
}

bool confirm(QWidget *parent, const QString &title, const QString &summary, const QString &action) {
    QMessageBox box(QMessageBox::Question, title, summary, QMessageBox::NoButton, parent);
    box.setTextFormat(Qt::PlainText);
    auto *accept = box.addButton(action, QMessageBox::AcceptRole);
    auto *cancel = box.addButton("取消", QMessageBox::RejectRole);
    box.setDefaultButton(cancel);
    box.exec();
    return box.clickedButton() == accept;
}

QString counts(const QJsonObject &state) {
    const auto rules = state.value("rules").toArray();
    int active = 0, reviews = 0;
    for (const auto &value : rules) {
        const QJsonObject rule = value.toObject();
        if (rule.value("archivedAt").isNull()) ++active;
        if (rule.value("review").isObject()) ++reviews;
    }
    return QString("%1 个类别 · %2 项生效 · %3 项归档 · %4 份复盘")
        .arg(state.value("categories").toArray().size()).arg(active)
        .arg(rules.size() - active).arg(reviews);
}

void writeBackup(const QString &path, const QJsonObject &state) {
    QSaveFile file(path);
    const auto bytes = QJsonDocument(state).toJson(QJsonDocument::Indented);
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
        throw std::runtime_error(file.errorString().toStdString());
}

bool editReview(QWidget *parent, Store &store, const QJsonObject &rule) {
    QDialog dialog(parent);
    dialog.setWindowTitle("失守复盘");
    dialog.resize(500, 365);
    auto *layout = new QVBoxLayout(&dialog);
    layout->addWidget(label(rule.value("title").toString(), 14));
    const QJsonValue previous = rule.value("review");
    auto *reason = new QPlainTextEdit(previous.toObject().value("reason").toString());
    reason->setAccessibleName("失败原因");
    reason->setPlaceholderText("当时遇到了什么情况？");
    auto *improvement = new QPlainTextEdit(previous.toObject().value("improvement").toString());
    improvement->setAccessibleName("改进计划");
    improvement->setPlaceholderText("下次准备在哪个时刻，换成什么行动？");
    layout->addWidget(label("失败原因（选填）"));
    layout->addWidget(reason);
    layout->addWidget(label("改进计划（选填）"));
    layout->addWidget(improvement);
    auto *buttons = new QDialogButtonBox;
    auto *save = buttons->addButton("保存复盘", QDialogButtonBox::AcceptRole);
    buttons->addButton("取消", QDialogButtonBox::RejectRole);
    layout->addWidget(buttons);
    QObject::connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    QObject::connect(save, &QPushButton::clicked, &dialog, [&] {
        try {
            store.saveReview(rule.value("id").toString(),
                             {{"reason", reason->toPlainText()}, {"improvement", improvement->toPlainText()}},
                             previous);
            dialog.accept();
        } catch (const std::exception &ex) { showError(&dialog, ex); }
    });
    return dialog.exec() == QDialog::Accepted;
}
}

QWidget *Pages::history(const QJsonObject &state, Store &store, std::function<void()> changed,
                        std::function<void(QJsonObject)> retry) {
    auto *page = new QWidget;
    auto *layout = pageLayout(page, "历史档案");
    QVector<QJsonObject> archived;
    QHash<QString, QString> names, incidents;
    bool quota = true;
    const QString today = QDate::currentDate().toString(Qt::ISODate);
    for (const auto &value : state.value("categories").toArray()) {
        const auto category = value.toObject();
        names.insert(category.value("id").toString(), category.value("name").toString());
    }
    for (const auto &value : state.value("rules").toArray()) {
        const auto rule = value.toObject();
        if (rule.value("day").toString() == today) quota = false;
        if (rule.value("archivedAt").isNull()) continue;
        archived.append(rule);
        if (rule.value("cause").toString() == "breach")
            incidents.insert(rule.value("incidentId").toString(), rule.value("title").toString());
    }
    if (archived.isEmpty()) {
        auto *empty = card(layout, "暂无撤回记录");
        empty->addWidget(label("国策失守后，可在这里补写失败原因、查看受影响的分支，并选择一项重试。"));
        layout->addStretch();
        return page;
    }
    std::stable_sort(archived.begin(), archived.end(), [](const QJsonObject &a, const QJsonObject &b) {
        const auto first = a.value("archivedAt").toString(), second = b.value("archivedAt").toString();
        if (first == second)
            return a.value("cause").toString() == "breach" && b.value("cause").toString() != "breach";
        return first > second;
    });
    auto *splitter = new QSplitter;
    auto *list = new QListWidget;
    list->setAccessibleName("撤回记录");
    list->setIconSize(QSize(38, 38));
    for (const auto &rule : archived) {
        const auto date = QDateTime::fromString(rule.value("archivedAt").toString(), Qt::ISODateWithMs)
                              .toLocalTime().date().toString(Qt::ISODate);
        const QString status = rule.value("cause").toString() == "breach" ? "主动报告失守" : "随父节点撤回";
        const auto emblem = QIcon(":/emblems/" + rule.value("badge").toString() + ".png");
        auto *item = new QListWidgetItem(emblem, rule.value("title").toString() + "\n" + date + " · " + status, list);
        item->setSizeHint(QSize(160, 57));
    }
    auto *details = new QWidget;
    auto *detailLayout = new QVBoxLayout(details);
    auto *title = label("", 16);
    auto *meta = label("");
    auto *instructions = label("");
    auto *source = label("");
    auto *reviewText = label("");
    for (auto *line : {title, meta, instructions, source, reviewText}) {
        line->setTextInteractionFlags(Qt::TextSelectableByMouse);
        detailLayout->addWidget(line);
    }
    auto *edit = new QPushButton;
    auto *again = new QPushButton("重试这项国策");
    again->setEnabled(quota);
    detailLayout->addWidget(edit, 0, Qt::AlignLeft);
    detailLayout->addWidget(again, 0, Qt::AlignLeft);
    if (!quota) detailLayout->addWidget(label("今日新增名额已用完。"));
    detailLayout->addStretch();
    splitter->addWidget(list);
    splitter->addWidget(scrollPage(details));
    splitter->setChildrenCollapsible(false);
    splitter->setStretchFactor(1, 2);
    layout->addWidget(splitter, 1);
    QObject::connect(list, &QListWidget::currentRowChanged, page, [=](int index) {
        if (index < 0 || index >= archived.size()) return;
        const auto rule = archived.at(index);
        title->setText(rule.value("title").toString());
        meta->setText(names.value(rule.value("categoryId").toString(), "未分类"));
        instructions->setText(QString("触发时机  %1\n具体行动  %2")
                                  .arg(rule.value("trigger").toString(), rule.value("action").toString()));
        const bool breach = rule.value("cause").toString() == "breach";
        source->setText(breach ? "主动报告失守" : "随上级撤回 · 失守国策为「" +
                              incidents.value(rule.value("incidentId").toString()) + "」");
        const auto review = rule.value("review").toObject();
        QStringList lines;
        for (const auto &key : {QString("reason"), QString("improvement")}) {
            const auto value = review.value(key).toString();
            if (!value.isEmpty()) lines.append((key == "reason" ? "失败原因\n" : "改进计划\n") + value);
        }
        reviewText->setText(lines.join("\n\n"));
        reviewText->setVisible(!lines.isEmpty());
        edit->setVisible(breach);
        edit->setText(review.isEmpty() ? "补记复盘" : "编辑复盘");
    });
    QObject::connect(edit, &QPushButton::clicked, page, [=, &store] {
        const int row = list->currentRow();
        if (row >= 0 && editReview(page, store, archived.at(row))) changed();
    });
    QObject::connect(again, &QPushButton::clicked, page, [=] {
        if (list->currentRow() >= 0) retry(archived.at(list->currentRow()));
    });
    list->setCurrentRow(0);
    return page;
}

void Pages::categories(QWidget *parent, const QJsonObject &state, Store &store, std::function<void()> changed) {
    QDialog dialog(parent);
    dialog.setWindowTitle("类别管理");
    dialog.resize(450, 400);
    auto *layout = new QVBoxLayout(&dialog);
    layout->addWidget(label("国策类别", 16));
    layout->addWidget(label("类别用于整理分支，可以随时增改。全树共用的每日名额只用于建立国策。"));
    auto *list = new QListWidget;
    list->setAccessibleName("国策类别");
    layout->addWidget(list);
    auto *actions = new QHBoxLayout;
    auto *add = new QPushButton("新增类别");
    auto *rename = new QPushButton("重命名");
    auto *remove = new QPushButton("删除类别");
    actions->addWidget(add);
    actions->addWidget(rename);
    actions->addWidget(remove);
    actions->addStretch();
    layout->addLayout(actions);
    auto *buttons = new QDialogButtonBox;
    buttons->addButton("完成", QDialogButtonBox::AcceptRole);
    layout->addWidget(buttons);
    QObject::connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept);
    bool modified = false;
    const auto render = [&](const QJsonObject &snapshot, const QString &selectedId = {}) {
        list->clear();
        QHash<QString, int> totals;
        for (const auto &value : snapshot.value("rules").toArray())
            ++totals[value.toObject().value("categoryId").toString()];
        for (const auto &value : snapshot.value("categories").toArray()) {
            const auto category = value.toObject();
            const auto id = category.value("id").toString(), name = category.value("name").toString();
            auto *item = new QListWidgetItem(QString("%1  ·  %2 项").arg(name).arg(totals.value(id)), list);
            item->setData(Qt::UserRole, id);
            item->setData(Qt::UserRole + 1, name);
            if (id == selectedId) list->setCurrentItem(item);
        }
        if (list->currentRow() < 0 && list->count()) list->setCurrentRow(0);
        rename->setEnabled(list->count() > 0);
        remove->setEnabled(list->count() > 0);
    };
    const auto nameDialog = [&](bool create) {
        const auto *selected = list->currentItem();
        if (!create && !selected) return;
        const auto id = create ? QString() : selected->data(Qt::UserRole).toString();
        const auto oldName = create ? QString() : selected->data(Qt::UserRole + 1).toString();
        bool ok = false;
        const auto name = QInputDialog::getText(&dialog, create ? "新增类别" : "重命名类别",
                                                "类别名称", QLineEdit::Normal, oldName, &ok);
        if (!ok) return;
        try {
            auto next = create ? store.addCategory(name) : store.renameCategory(id, name);
            const auto selectedId = create ? next.value("categories").toArray().last().toObject().value("id").toString() : id;
            render(next, selectedId);
            modified = true;
        } catch (const std::exception &ex) { showError(&dialog, ex); }
    };
    QObject::connect(add, &QPushButton::clicked, &dialog, [&] { nameDialog(true); });
    QObject::connect(rename, &QPushButton::clicked, &dialog, [&] { nameDialog(false); });
    QObject::connect(remove, &QPushButton::clicked, &dialog, [&] {
        const auto *item = list->currentItem();
        if (!item) return;
        const auto name = item->data(Qt::UserRole + 1).toString();
        if (!confirm(&dialog, "删除类别", QString("删除「%1」后，该类别下的国策和历史将归入「未分类」。").arg(name),
                     "删除类别")) return;
        try {
            render(store.removeCategory(item->data(Qt::UserRole).toString()));
            modified = true;
        } catch (const std::exception &ex) { showError(&dialog, ex); }
    });
    render(state);
    dialog.exec();
    if (modified) changed();
}

QWidget *Pages::backups(Store &store, std::function<void()> changed) {
    auto *page = new QWidget;
    auto *layout = pageLayout(page, "数据备份与迁移");
    try { layout->addWidget(label("桌面档案   " + counts(store.load()))); }
    catch (const std::exception &ex) { layout->addWidget(label(QString::fromUtf8(ex.what()))); }
    auto *migration = card(layout, "从网页版迁入");
    migration->addWidget(label("用原来的浏览器和用户配置打开原来的网址，在「数据备份」导出 JSON。然后在本页选择该文件。迁入后，两边的档案各自保存。"));
    auto *launch = new QPushButton("打开原本机网页版");
    launch->setToolTip("http://127.0.0.1:4173/#backup");
    migration->addWidget(launch, 0, Qt::AlignLeft);
    migration->addWidget(label("本机预览地址为 http://127.0.0.1:4173/#backup。使用其他地址或手机的人，请在原设备、原网址导出。"));
    QObject::connect(launch, &QPushButton::clicked, page, [page] {
        if (!QDesktopServices::openUrl(QUrl("http://127.0.0.1:4173/#backup")))
            QMessageBox::information(page, "打开网页版", "请在原浏览器中打开 http://127.0.0.1:4173/#backup。");
    });
    auto *imports = card(layout, "导入档案");
    imports->addWidget(label("支持 v1、v2、v3 JSON 备份。核对数量并确认后导入。替换已有桌面档案时，原档案会自动备份到同一数据目录。"));
    auto *pick = new QPushButton("选择备份文件…");
    imports->addWidget(pick, 0, Qt::AlignLeft);
    auto *exports = card(layout, "导出桌面档案");
    exports->addWidget(label("导出类别、国策树、每日名额和含复盘的完整历史。可用于另一台设备或最新版网页。"));
    auto *save = new QPushButton("导出 JSON…");
    exports->addWidget(save, 0, Qt::AlignLeft);
    const QString archiveDir = QFileInfo(store.filePath()).absolutePath();
    auto *openRecovery = new QPushButton("打开桌面档案目录");
    openRecovery->setToolTip(QDir::toNativeSeparators(archiveDir));
    imports->addWidget(openRecovery, 0, Qt::AlignLeft);
    QObject::connect(openRecovery, &QPushButton::clicked, page, [page, archiveDir] {
        if (!QDesktopServices::openUrl(QUrl::fromLocalFile(archiveDir)))
            QMessageBox::information(page, "桌面档案目录", QDir::toNativeSeparators(archiveDir));
    });
    layout->addStretch();
    QObject::connect(save, &QPushButton::clicked, page, [page, &store] {
        const QDir dir(QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation));
        const auto path = QFileDialog::getSaveFileName(page, "导出完整档案", dir.filePath(
            "daily-rule-backup-v3-" + QDate::currentDate().toString(Qt::ISODate) + ".json"), "JSON 备份 (*.json)");
        if (path.isEmpty()) return;
        try {
            if (QFileInfo(path) == QFileInfo(store.filePath()))
                throw std::runtime_error("请选择一个单独的备份文件名。");
            writeBackup(path, store.load());
            QMessageBox::information(page, "导出完成", "档案已保存到所选文件。");
        } catch (const std::exception &ex) { showError(page, ex); }
    });
    QObject::connect(pick, &QPushButton::clicked, page, [page, &store, changed] {
        const auto path = QFileDialog::getOpenFileName(page, "选择国策备份",
            QStandardPaths::writableLocation(QStandardPaths::DownloadLocation), "JSON 备份 (*.json);;所有文件 (*)");
        if (path.isEmpty()) return;
        try {
            QFile file(path);
            if (!file.open(QIODevice::ReadOnly)) throw std::runtime_error(file.errorString().toStdString());
            const auto bytes = file.readAll();
            if (file.error() != QFileDevice::NoError) throw std::runtime_error(file.errorString().toStdString());
            file.close();
            const auto incoming = Store::decode(bytes);
            const auto current = store.load();
            if (incoming == current) {
                QMessageBox::information(page, "档案一致", "桌面档案与所选备份的内容一致。");
                return;
            }
            const QString summary = QString("当前桌面档案\n%1\n\n即将导入的档案\n%2\n\n确认后将用所选备份替换桌面档案。已有档案将自动保存恢复副本。")
                                        .arg(counts(current), counts(incoming));
            if (!confirm(page, "核对导入内容", summary, "确认导入")) return;
            store.importBackup(bytes, current);
            QMessageBox::information(page, "导入完成", "国策档案已恢复。如本次替换了已有档案，可在桌面档案目录中找到文件名带 before-import 的恢复副本。");
            changed();
        } catch (const std::exception &ex) { showError(page, ex); }
    });
    return scrollPage(page);
}

QWidget *Pages::guide() {
    auto *page = new QWidget;
    auto *layout = pageLayout(page, "规则指南");
    card(layout, "把干预放在更早的时刻")->addWidget(label(
        "找出容易重复出现的困境，向前找到自己还能改变的动作。写下触发时机，再写具体行动。例如，进卧室前，把手机留在客厅。"));
    card(layout, "每天最多建立一项")->addWidget(label(
        "按本地自然日计算。新建分支、添加子国策和重试共用每日名额，当天也可以只查看。空根连接各个类别，子国策沿用上级的类别。"));
    card(layout, "失守时撤回整条分支")->addWidget(label(
        "国策持续生效。自己确认违反时，在详情中选择「记录失守」，核对撤回范围，可填写失败原因和改进计划。该节点及其全部后代一起撤回。"));
    card(layout, "从另一条路径重试")->addWidget(label(
        "在「历史档案」选择一项撤回记录，可补记复盘，或换个位置重试这一项。重新建立时，可调整触发时机和具体行动。"));
    layout->addWidget(label("规则依据 · edmond《如何提高自制力？》第 23–27 页，递归稳态迭代协议（RSIP）。"));
    layout->addStretch();
    return scrollPage(page);
}
