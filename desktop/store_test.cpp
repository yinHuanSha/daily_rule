#include "store.h"
#include <QCoreApplication>
#include <QDate>
#include <QDebug>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QProcess>
#include <QTemporaryDir>
#include <stdexcept>

namespace {
void check(bool ok, const char *label) {
    if (!ok) throw std::runtime_error(label);
}
template <typename F> void rejects(F action, const char *label) {
    try { action(); } catch (const std::runtime_error &) { return; }
    throw std::runtime_error(label);
}
QJsonObject fixture(QJsonObject state) {
    const auto null = QJsonValue(QJsonValue::Null);
    QJsonArray rules;
    const QStringList ids{"B", "C", "D", "E", "F", "G", "H"};
    const QStringList parents{"", "B", "B", "B", "C", "D", "F"};
    for (int i = 0; i < ids.size(); ++i) {
        const auto day = QDate(2020, 1, 1).addDays(i).toString(Qt::ISODate);
        rules.append(QJsonObject{{"id", ids.at(i)}, {"parentId", i ? QJsonValue(parents.at(i)) : null},
            {"categoryId", "life"}, {"title", ids.at(i)}, {"trigger", "进门时"}, {"action", "手机朝下"},
            {"badge", "sun"}, {"createdAt", day + "T00:00:00.000Z"}, {"day", day},
            {"archivedAt", null}, {"incidentId", null}, {"cause", null}, {"retryOf", null}});
    }
    state["rules"] = rules;
    return state;
}
QByteArray bytes(const QJsonObject &state) { return QJsonDocument(state).toJson(); }
QJsonObject ruleAt(const QJsonObject &state, int index) { return state.value("rules").toArray().at(index).toObject(); }
QJsonObject newRule() {
    return {{"parentId", QJsonValue::Null}, {"title", "读一页"}, {"trigger", "午休时"}, {"action", "翻开书"}, {"badge", "book"}};
}
int addInChild(const QString &path) {
    try { Store(path).addRule(newRule()); return 0; }
    catch (const std::runtime_error &e) {
        return QString::fromUtf8(e.what()).contains("今天已新增") ? 11 : 12;
    }
}
void runTests(const QString &exe) {
    QTemporaryDir dir;
    check(dir.isValid(), "temporary directory");
    const auto path = dir.filePath("archive.json");
    Store store(path);
    const auto initial = store.load();
    const auto source = fixture(initial);
    check(Store::decode(bytes(source)) == source, "v3 roundtrip");
    auto v1 = source;
    v1["version"] = 1;
    v1.remove("categories");
    auto oldRules = v1.value("rules").toArray();
    for (int i = 0; i < oldRules.size(); ++i) {
        auto rule = oldRules.at(i).toObject();
        rule.remove("categoryId");
        oldRules[i] = rule;
    }
    v1["rules"] = oldRules;
    const auto upgraded = Store::decode(bytes(v1));
    check(upgraded.value("version") == 3 && upgraded.value("categories") == initial.value("categories") &&
          ruleAt(upgraded, 1).value("categoryId").isNull() && ruleAt(upgraded, 1).value("parentId") == "B", "v1 migration");
    auto v2 = source;
    v2["version"] = 2;
    check(Store::decode(bytes(v2)) == source, "v2 migration");
    // JS Date.toISOString() also accepts year zero and signed extended years.
    for (const auto &stamp : {"0000-02-29T00:00:00.000Z", "-000001-01-01T00:00:00.000Z", "+275760-09-13T00:00:00.000Z"}) {
        auto obj = ruleAt(source, 0);
        obj["createdAt"] = stamp;
        obj["day"] = "0000-02-29";
        auto ancient = initial;
        ancient["rules"] = QJsonArray{obj};
        check(Store::decode(bytes(ancient)) == ancient, "retain valid web ISO dates");
    }
    for (const auto &stamp : {"2023-02-29T00:00:00.000Z", "+009999-01-01T00:00:00.000Z",
                               "+275760-09-13T00:00:00.001Z", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00.000+00:00"}) {
        auto obj = ruleAt(source, 0);
        obj["createdAt"] = stamp;
        auto invalid = initial;
        invalid["rules"] = QJsonArray{obj};
        rejects([&]{ Store::decode(bytes(invalid)); }, "reject malformed timestamp");
    }
    QJsonArray chain;
    for (int i = 0; i < 3000; ++i) {
        auto rule = ruleAt(source, 0);
        rule["id"] = QString::number(i);
        rule["parentId"] = i ? QJsonValue(QString::number(i-1)) : QJsonValue(QJsonValue::Null);
        rule["day"] = QDate(2010, 1, 1).addDays(i).toString(Qt::ISODate);
        chain.append(rule);
    }
    auto deep = initial;
    deep["rules"] = chain;
    check(Store::decode(bytes(deep)) == deep, "deep tree uses iterative graph validation");
    check(store.importBackup(bytes(v2), initial) == source, "import");
    rejects([&]{ store.importBackup(bytes(initial), source, true); }, "first-launch migration refuses existing archive");
    rejects([&]{ store.importBackup(bytes(initial), initial); }, "stale import");
    rejects([&]{ store.prune("C", {"C", "F"}, {}, {}); }, "stale prune");
    auto state = store.prune("C", {"C","F","H"}, " 忘带书 ", " 提前准备 ");
    check(ruleAt(state,1).value("review").toObject().value("reason") == "忘带书", "trim archive review");
    check(ruleAt(state,4).value("cause") == "ancestor" && ruleAt(state,6).value("incidentId") == "C" &&
          !ruleAt(state,6).contains("review") && ruleAt(state,5).value("archivedAt").isNull(), "subtree only");
    auto historical = state;
    historical["version"] = 2;
    auto archiveRows = historical.value("rules").toArray();
    for (int i : {1, 4, 6}) {
        auto row = archiveRows.at(i).toObject();
        row.remove("review");
        row["incidentId"] = "original-archive-event";
        archiveRows[i] = row;
    }
    historical["rules"] = archiveRows;
    check(Store::decode(bytes(historical)).value("rules") == archiveRows, "v2 preserves independent historical incident IDs");
    const auto previous = ruleAt(state,1).value("review");
    const QJsonObject note{{"reason", "睡不够"}, {"improvement", ""}};
    rejects([&]{ store.saveReview("F", note, QJsonValue::Null); }, "ancestor review");
    store.saveReview("C", note, previous);
    rejects([&]{ store.saveReview("C", note, previous); }, "stale review");
    const auto blank = QJsonObject{{"reason"," "}, {"improvement",""}};
    check(!ruleAt(store.saveReview("C", blank, note),1).contains("review"), "clear review");
    auto retry = newRule();
    retry["retryOf"] = "C";
    retry["parentId"] = "E";
    state = store.addRule(retry);
    check(state.value("rules").toArray().size() == 8 && ruleAt(state,7).value("retryOf") == "C" &&
          ruleAt(state,7).value("categoryId") == "life", "retry as one leaf");
    const auto retryId = ruleAt(state,7).value("id").toString();
    store.prune(retryId, {retryId}, {}, {});
    rejects([&]{ store.addRule(newRule()); }, "pruned today's rule holds quota");
    state = store.addCategory("  Focus ");
    const auto custom = state.value("categories").toArray().last().toObject().value("id").toString();
    rejects([&]{ store.addCategory("ＦＯＣＵＳ"); }, "NFKC duplicate category");
    rejects([&]{ store.renameCategory(custom,"未分类"); }, "reserved category");
    store.renameCategory(custom, "科研");
    state = store.moveBranch("B", custom);
    check(ruleAt(state,6).value("categoryId") == custom, "move archived descendants");
    state = store.removeCategory(custom);
    check(ruleAt(state,6).value("categoryId").isNull(), "remove category keeps history");
    check(Store(path).load() == state && Store::decode(bytes(state)) == state, "restart and export");
    auto invalid = source;
    auto rules = invalid.value("rules").toArray();
    auto root = rules.first().toObject();
    root["parentId"] = "H";
    rules[0] = root;
    invalid["rules"] = rules;
    rejects([&]{ store.importBackup(bytes(invalid), state); }, "cyclic backup");
    check(store.load() == state, "invalid import leaves state unchanged");
    store.importBackup(bytes(initial), state);
    const auto backups = QDir(dir.path()).entryList({"archive.json.before-import-*.json"});
    check(backups.size() == 1, "import recovery file");
    QFile backup(dir.filePath(backups.first()));
    check(backup.open(QIODevice::ReadOnly) && Store::decode(backup.readAll()) == state, "exact pre-import recovery");
    QFile corrupted(path);
    check(corrupted.open(QIODevice::WriteOnly | QIODevice::Truncate) && corrupted.write("{broken") == 7, "damage fixture");
    corrupted.close();
    rejects([&]{ store.addCategory("工作"); }, "reject changes on corrupt archive");
    check(corrupted.open(QIODevice::ReadOnly) && corrupted.readAll() == "{broken", "corrupt file preserved");
    QProcess first, second;
    const QStringList args{"--race", dir.filePath("race.json")};
    first.start(exe, args);
    second.start(exe, args);
    check(first.waitForFinished(12000) && second.waitForFinished(12000), "finish concurrent processes");
    check((first.exitCode() == 0 && second.exitCode() == 11) || (second.exitCode() == 0 && first.exitCode() == 11),
          "two concurrent processes consume only one quota");
}
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    const auto args = app.arguments();
    if (args.size() == 3 && args.at(1) == "--race") return addInChild(args.at(2));
    try {
        runTests(app.applicationFilePath());
        qInfo() << "Passed: native archives, migration, tree operations, review, recovery and concurrent writes.";
        return 0;
    } catch (const std::exception &error) {
        qCritical().noquote() << QString::fromUtf8(error.what());
        return 1;
    }
}
