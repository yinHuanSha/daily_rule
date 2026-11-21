#include "pages.h"
#include "store.h"
#include "treepage.h"

#include <QtWidgets>
#include <QtTest/QTest>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <memory>

namespace {
void verify(bool ok, const QString& detail) {
    if (ok) return;
    std::fprintf(stderr, "UI test failure: %s\n", detail.toUtf8().constData());
    std::exit(1);
}

QPushButton* button(QWidget* page, const QString& text) {
    verify(page, "Missing page for " + text);
    for (auto* candidate : page->findChildren<QPushButton*>())
        if (candidate->text() == text && candidate->isVisibleTo(page)) return candidate;
    verify(false, "Missing button " + text);
    return nullptr;
}

QDialog* currentDialog(const QString& title) {
    auto* widget = qobject_cast<QDialog*>(QApplication::activeModalWidget());
    verify(widget && widget->windowTitle() == title, "Expected dialog " + title + ", saw " +
           (widget ? widget->windowTitle() : QString("none")));
    return widget;
}

void openPin(TreePage& tree, const QString& title) {
    auto* view = tree.findChild<QGraphicsView*>();
    for (auto* item : view->scene()->items()) {
        if (item->toolTip() != title) continue;
        const auto pos = view->mapFromScene(item->sceneBoundingRect().center());
        verify(view->viewport()->rect().contains(pos), "Pin is outside the viewport");
        QTest::mouseClick(view->viewport(), Qt::LeftButton, Qt::NoModifier, pos);
        return;
    }
    verify(false, "Missing map pin " + title);
}
}

// Run in a temporary profile. Optional first argument receives QA screenshots.
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    QTemporaryDir directory;
    verify(directory.isValid(), "Missing temporary directory");
    const auto path = directory.filePath("test.json");
    Store store(path);
    TreePage tree(store, [] {}, [] {});
    tree.resize(960, 650);
    tree.refresh(store.load());
    tree.show();
    std::unique_ptr<QWidget> history;
    QString originalId;
    const QString title = "放下手机";
    const QString reason = "等待通知时拿起了手机";
    const QString improvement = "打开专注模式再开始工作";
    const QString output = app.arguments().value(1);
    auto capture = [&](QWidget* widget, const QString& basename) {
        if (output.isEmpty()) return;
        verify(QDir().mkpath(output), "Could not create screenshot directory");
        verify(widget->grab().save(QDir(output).filePath(basename)), "Could not save screenshot");
    };
    QVector<std::function<void()>> steps;
    steps << [&] {
        button(&tree, "示例图")->click();
        capture(&tree, "01-example.png");
        verify(store.load().value("rules").toArray().isEmpty(), "Example modified live tree");
        button(&tree, "返回我的国策")->click();
        button(&tree, "新建分支")->click();
    } << [&] {
        auto* dialog = currentDialog("新建分支");
        dialog->findChild<QLineEdit*>()->setText(title);
        const auto edits = dialog->findChildren<QPlainTextEdit*>();
        verify(edits.size() == 2, "Missing trigger or action");
        edits[0]->setPlainText("坐到桌前");
        edits[1]->setPlainText("将手机朝下");
        button(dialog, "建立国策")->click();
    } << [&] {
        auto saved = store.load();
        auto rules = saved.value("rules").toArray();
        verify(rules.size() == 1 && rules.first().toObject().value("title").toString() == title, "Add did not persist");
        originalId = rules.first().toObject().value("id").toString();
        verify(!button(&tree, "新建分支")->isEnabled(), "Daily quota after first addition");
        // Rebase the synthetic record to yesterday to exercise a second day's child and retry.
        auto first = rules.first().toObject();
        const auto yesterday = QDateTime::currentDateTimeUtc().addDays(-2);
        first["day"] = yesterday.toLocalTime().date().toString(Qt::ISODate);
        first["createdAt"] = yesterday.toString(Qt::ISODateWithMs);
        saved["rules"] = QJsonArray{first};
        tree.refresh(store.importBackup(QJsonDocument(saved).toJson(), store.load()));
        openPin(tree, title);
    } << [&] {
        button(currentDialog("国策详情"), "添加子国策")->click();
    } << [&] {
        auto* dialog = currentDialog("添加子国策");
        dialog->findChild<QLineEdit*>()->setText("开始工作");
        const auto edits = dialog->findChildren<QPlainTextEdit*>();
        edits[0]->setPlainText("放下手机时");
        edits[1]->setPlainText("打开书");
        button(dialog, "建立国策")->click();
    } << [&] {
        auto saved = store.load();
        auto rules = saved.value("rules").toArray();
        verify(rules.size() == 2, "Child missing");
        auto child = rules[1].toObject();
        verify(child.value("parentId").toString() == originalId, "Child parent missing");
        const auto yesterday = QDateTime::currentDateTimeUtc().addDays(-1);
        child["day"] = yesterday.toLocalTime().date().toString(Qt::ISODate);
        child["createdAt"] = yesterday.toString(Qt::ISODateWithMs);
        rules[1] = child;
        saved["rules"] = rules;
        tree.refresh(store.importBackup(QJsonDocument(saved).toJson(), store.load()));
        openPin(tree, title);
    } << [&] {
        button(currentDialog("国策详情"), "记录失守")->click();
    } << [&] {
        auto* dialog = currentDialog("记录失守与剪枝");
        verify(dialog->findChild<QListWidget*>()->count() == 2, "Subtree preview lost a node");
        const auto edits = dialog->findChildren<QPlainTextEdit*>();
        edits[0]->setPlainText(reason);
        edits[1]->setPlainText(improvement);
        capture(dialog, "02-breach.png");
        button(dialog, "确认撤回")->click();
    } << [&] {
        Store reopened(path);
        const auto saved = reopened.load();
        const auto rules = saved.value("rules").toArray();
        verify(rules[0].toObject().value("review").toObject().value("reason") == reason, "Review not persisted");
        verify(rules[1].toObject().value("cause").toString() == "ancestor", "Child cause lost");
        history.reset(Pages::history(saved, store, [] {}, [&](QJsonObject r) { tree.retry(r); }));
        history->resize(840, 520);
        history->show();
        capture(history.get(), "03-history.png");
        button(history.get(), "编辑复盘")->click();
    } << [&] {
        auto* dialog = currentDialog("失守复盘");
        const auto edits = dialog->findChildren<QPlainTextEdit*>();
        verify(edits[0]->toPlainText() == reason && edits[1]->toPlainText() == improvement, "History review content mismatch");
        edits[1]->setPlainText(improvement + "。");
        button(dialog, "保存复盘")->click();
    } << [&] {
        const auto saved = store.load();
        verify(saved.value("rules").toArray()[0].toObject().value("review").toObject().value("improvement") == improvement + "。", "Review edit lost");
        tree.refresh(saved);
        button(history.get(), "重试这项国策")->click();
    } << [&] {
        auto* dialog = currentDialog("重新尝试国策");
        const auto edits = dialog->findChildren<QPlainTextEdit*>();
        verify(edits.size() == 3 && edits[0]->toPlainText().contains(improvement + "。"), "Retry omitted latest review");
        button(dialog, "建立国策")->click();
    } << [&] {
        const auto rules = Store(path).load().value("rules").toArray();
        verify(rules.size() == 3 && rules.last().toObject().value("retryOf").toString() == originalId &&
               rules.last().toObject().value("archivedAt").isNull(), "Retry did not create one new active rule");
        std::puts("Desktop UI smoke test passed");
        app.exit(0);
    };
    // Queue each following step before entering the current modal event loop.
    std::function<void(int)> advance = [&](int index) {
        if (index + 1 < steps.size()) QTimer::singleShot(100, &app, [&, index] { advance(index + 1); });
        steps[index]();
    };
    QTimer::singleShot(100, &app, [&] { advance(0); });
    QTimer::singleShot(30000, &app, [] { verify(false, "Desktop test timeout"); });
    return app.exec();
}
