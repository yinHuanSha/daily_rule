#include "pages.h"
#include "store.h"
#include "treepage.h"

#include <QApplication>
#include <QButtonGroup>
#include <QCommandLineParser>
#include <QDate>
#include <QDir>
#include <QFileInfo>
#include <QLabel>
#include <QMainWindow>
#include <QMessageBox>
#include <QPushButton>
#include <QScreen>
#include <QStackedWidget>
#include <QStandardPaths>
#include <QTimer>
#include <QVBoxLayout>
#include <exception>

namespace {
enum Page { Tree, History, Backup, Guide };

class Window final : public QMainWindow {
public:
    explicit Window(const QString &path) : file(path), store(path) {
        setWindowTitle("每日国策 · Daily Rule");
        const auto available = QGuiApplication::primaryScreen()->availableGeometry().size();
        resize(QSize(1160, 790).boundedTo(available));
        auto *body = new QWidget;
        setCentralWidget(body);
        auto *layout = new QHBoxLayout(body);
        layout->setContentsMargins(0, 0, 0, 0);
        layout->setSpacing(0);

        auto *rail = new QFrame;
        rail->setObjectName("rail");
        rail->setFixedWidth(166);
        auto *nav = new QVBoxLayout(rail);
        nav->setContentsMargins(14, 28, 14, 18);
        nav->setSpacing(6);
        auto *mark = new QLabel;
        mark->setPixmap(QIcon(":/icon.png").pixmap(44, 44));
        nav->addWidget(mark);
        auto *name = new QLabel("每日国策");
        name->setObjectName("brand");
        nav->addWidget(name);
        nav->addSpacing(25);
        const QStringList titles{"国策树", "历史档案", "数据备份", "国策手册"};
        for (int i = 0; i < titles.size(); ++i) {
            auto *button = new QPushButton(titles[i]);
            button->setCheckable(true);
            links.addButton(button, i);
            nav->addWidget(button);
            connect(button, &QPushButton::clicked, this, [this, i] { navigate(Page(i)); });
        }
        nav->addStretch();
        nav->addWidget(new QLabel("本机档案"));
        layout->addWidget(rail);
        stack = new QStackedWidget;
        layout->addWidget(stack, 1);

        tree = new TreePage(store, [this] { reload(); }, [this] {
            Pages::categories(this, state, store, [this] { reload(); });
        });
        stack->addWidget(tree);
        navigate(Tree);
        // A second window can change the archive. Refresh after modal edits have ended.
        auto *timer = new QTimer(this);
        connect(timer, &QTimer::timeout, this, [this] {
            if (QApplication::activeModalWidget() || !isActiveWindow()) return;
            const QFileInfo info(file);
            if (day != QDate::currentDate() || stamp != info.lastModified() || bytes != info.size())
                reload();
        });
        timer->start(1500);
    }

private:
    void reload() { navigate(page); }
    void navigate(Page next) {
        try {
            const QFileInfo info(file);
            stamp = info.lastModified();
            bytes = info.size();
            day = QDate::currentDate();
            state = store.load();
            tree->refresh(state);
            QWidget *target = tree;
            if (next == History) {
                target = Pages::history(state, store, [this] { reload(); }, [this](QJsonObject rule) {
                    navigate(Tree);
                    tree->retry(rule);
                });
            } else if (next == Backup) {
                target = Pages::backups(store, [this] { reload(); });
            } else if (next == Guide) {
                target = Pages::guide();
            }
            if (target != tree) stack->addWidget(target);
            stack->setCurrentWidget(target);
            if (secondary) {
                stack->removeWidget(secondary);
                secondary->deleteLater();
            }
            secondary = (target == tree ? nullptr : target);
            links.button(next)->setChecked(true);
            page = next;
        } catch (const std::exception &error) {
            links.button(page)->setChecked(true);
            QMessageBox::warning(this, "读取国策档案", QString::fromUtf8(error.what()));
        }
    }

    QString file;
    Store store;
    QJsonObject state;
    QDate day;
    QDateTime stamp;
    qint64 bytes = -1;
    Page page = Tree;
    QButtonGroup links;
    TreePage *tree = nullptr;
    QStackedWidget *stack = nullptr;
    QWidget *secondary = nullptr;
};
}

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    app.setApplicationName("DailyRule");
    app.setApplicationDisplayName("每日国策");
    app.setApplicationVersion("1.0.0");
    app.setWindowIcon(QIcon(":/icon.png"));
    QCommandLineParser options;
    options.addHelpOption();
    options.addVersionOption();
    options.addOption({"data-dir", "使用指定的本地档案目录。", "directory"});
    options.addOption({"import-new", "在首次使用前，从网页 JSON 备份建立桌面档案并退出。", "backup"});
    options.process(app);
    const QDir dir(options.isSet("data-dir") ? options.value("data-dir") :
                   QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation));
    const QString file = dir.filePath("archive.json");
    if (options.isSet("import-new")) {
        try {
            Store store(file);
            const auto initial = store.load();
            if (QFileInfo::exists(file)) return 2;
            QFile input(options.value("import-new"));
            if (!input.open(QIODevice::ReadOnly)) return 3;
            const auto bytes = input.readAll();
            if (input.error() != QFileDevice::NoError) return 3;
            const auto incoming = Store::decode(bytes);
            store.importBackup(bytes, initial, true);
            return store.load() == incoming ? 0 : 4;
        } catch (const std::exception &) {
            return 4;
        }
    }
    app.setStyle("Fusion");
    auto palette = app.palette();
    palette.setColor(QPalette::Window, QColor("#f5f2e7"));
    palette.setColor(QPalette::WindowText, QColor("#243b32"));
    palette.setColor(QPalette::Base, QColor("#fffefa"));
    palette.setColor(QPalette::Text, QColor("#233c30"));
    palette.setColor(QPalette::Button, QColor("#f7f4e9"));
    palette.setColor(QPalette::ButtonText, QColor("#2c4437"));
    palette.setColor(QPalette::Highlight, QColor("#365c48"));
    palette.setColor(QPalette::HighlightedText, Qt::white);
    app.setPalette(palette);
    app.setFont(QFont("Microsoft YaHei UI", 10));
    app.setStyleSheet(R"(
        QPushButton { padding: 6px 11px; }
        QFrame#rail { background: #233b31; }
        QFrame#rail QLabel { color: #d6ddcb; background: transparent; }
        QLabel#brand { font-size: 22px; font-weight: bold; }
        QFrame#rail QPushButton { text-align: left; padding: 10px 14px;
            background: transparent; color: #f1eedf; border: 1px solid transparent; border-radius: 5px; }
        QFrame#rail QPushButton:checked { background: #405846; border-color: #71806b; }
        QFrame#rail QPushButton:hover { background: #344c40; }
    )");
    Window window(file);
    window.show();
    return app.exec();
}
