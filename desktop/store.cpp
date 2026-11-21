#include "store.h"
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLockFile>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSet>
#include <QUuid>
#include <stdexcept>

namespace {
[[noreturn]] void fail(const QString &message) {
    throw std::runtime_error(message.toUtf8().constData());
}

QJsonObject emptyTree() {
    QJsonArray categories;
    categories.append(QJsonObject{{"id", "life"}, {"name", "生活国策"}});
    categories.append(QJsonObject{{"id", "study"}, {"name", "学习国策"}});
    categories.append(QJsonObject{{"id", "work"}, {"name", "工作国策"}});
    return {{"version", 3}, {"categories", categories}, {"rules", QJsonArray()}};
}

// Match JavaScript String.trim: the web format treats BOM as whitespace and U+0085 as text.
QString trimText(const QString &value) {
    const auto space = [](QChar character) {
        const auto c = character.unicode();
        return (c >= 0x09 && c <= 0x0d) || c == 0x20 || c == 0xa0 || c == 0x1680 ||
            (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 || c == 0x202f ||
            c == 0x205f || c == 0x3000 || c == 0xfeff;
    };
    int first = 0, end = value.size();
    while (first < end && space(value.at(first))) ++first;
    while (end > first && space(value.at(end - 1))) --end;
    return value.mid(first, end - first);
}

bool isText(const QJsonValue &value) {
    return value.isString() && !trimText(value.toString()).isEmpty();
}

bool isNullableId(const QJsonValue &value) {
    return value.isNull() || isText(value);
}

QString categoryKey(const QString &input) {
    return input.normalized(QString::NormalizationForm_KC).toLower();
}

QString categoryName(const QString &input) {
    const auto name = trimText(input);
    if (name.isEmpty()) fail("请填写类别名称。");
    if (categoryKey(name) == "未分类") fail("“未分类”是系统保留的名称。");
    return name;
}

QJsonObject normalizeReview(const QJsonValue &value) {
    if (value.isUndefined()) return {};
    const auto obj = value.toObject();
    if (!obj.value("reason").isString() || !obj.value("improvement").isString())
        fail("复盘中的失败原因和改进计划须为文本。");
    const auto reason = trimText(obj.value("reason").toString());
    const auto improvement = trimText(obj.value("improvement").toString());
    if (reason.isEmpty() && improvement.isEmpty()) return {};
    return {{"reason", reason}, {"improvement", improvement}};
}

QDate isoDate(int astronomicalYear, int month, int day) {
    // ECMAScript labels 1 BCE as year 0000. Qt's proleptic Gregorian calendar skips year zero.
    return QDate(astronomicalYear > 0 ? astronomicalYear : astronomicalYear - 1, month, day);
}

bool validTime(const QJsonValue &value) {
    static const QRegularExpression pattern(QStringLiteral(
        "\\A([0-9]{4}|[+-][0-9]{6})-([0-9]{2})-([0-9]{2})T"
        "([0-9]{2}):([0-9]{2}):([0-9]{2})\\.([0-9]{3})Z\\z"));
    const auto m = pattern.match(value.toString());
    if (!m.hasMatch()) return false;
    const auto yearText = m.captured(1);
    const int year = yearText.toInt();
    if (yearText.size() > 4 && year >= 0 && year <= 9999) return false;
    const QDate day = isoDate(year, m.captured(2).toInt(), m.captured(3).toInt());
    const QTime time(m.captured(4).toInt(), m.captured(5).toInt(), m.captured(6).toInt(), m.captured(7).toInt());
    if (!day.isValid() || !time.isValid()) return false;
    const auto epoch = QDate(1970, 1, 1).daysTo(day) * 86400000LL + time.msecsSinceStartOfDay();
    return epoch >= -8640000000000000LL && epoch <= 8640000000000000LL;
}

bool validDay(const QJsonValue &value) {
    static const QRegularExpression pattern(QStringLiteral("\\A([0-9]{4})-([0-9]{2})-([0-9]{2})\\z"));
    const auto m = pattern.match(value.toString());
    return m.hasMatch() && isoDate(m.captured(1).toInt(), m.captured(2).toInt(), m.captured(3).toInt()).isValid();
}

int findId(const QJsonArray &items, const QJsonValue &id) {
    for (int i = 0; i < items.size(); ++i)
        if (items.at(i).toObject().value("id") == id) return i;
    return -1;
}

void requireCategory(const QJsonArray &items, const QJsonValue &id) {
    if (!id.isNull() && findId(items, id) < 0) fail("所选类别已不存在，请重新选择。");
}

QJsonArray readCategories(QJsonValue source) {
    if (!source.isArray()) fail("备份中缺少类别列表。");
    QSet<QString> ids, names;
    QJsonArray result;
    for (const auto &entry : source.toArray()) {
        auto obj = entry.toObject();
        if (!isText(obj.value("id")) || !isText(obj.value("name"))) fail("备份中的类别格式有误。");
        const auto id = obj.value("id").toString();
        const auto name = categoryName(obj.value("name").toString());
        const auto key = categoryKey(name);
        if (ids.contains(id) || names.contains(key)) fail("备份中的类别编号或名称重复。");
        ids.insert(id);
        names.insert(key);
        obj["name"] = name;
        result.append(obj);
    }
    return result;
}

bool validBadge(const QJsonValue &value) {
    static const QSet<QString> badges{"standard", "sun", "moon", "book", "leaf", "shield"};
    return badges.contains(value.toString());
}

QJsonObject readRule(QJsonObject rule, bool legacy) {
    const auto archived = rule.value("archivedAt");
    const auto cause = rule.value("cause");
    if (!isText(rule.value("id")) || !isNullableId(rule.value("parentId")) ||
        !isText(rule.value("title")) || !isText(rule.value("trigger")) ||
        !isText(rule.value("action")) || !validBadge(rule.value("badge")) ||
        !validTime(rule.value("createdAt")) || !validDay(rule.value("day")) ||
        !isNullableId(rule.value("retryOf")) || (!archived.isNull() && !validTime(archived)) ||
        !(cause.isNull() || cause == "breach" || cause == "ancestor") ||
        !isNullableId(rule.value("incidentId")))
        fail("备份中的国策字段不完整或格式有误。");
    if (archived.isNull() != cause.isNull() || archived.isNull() != rule.value("incidentId").isNull())
        fail("备份中的国策归档信息不一致。");
    if (legacy) rule["categoryId"] = QJsonValue::Null;
    if (!isNullableId(rule.value("categoryId"))) fail("备份中的国策缺少有效的类别字段。");
    const auto review = normalizeReview(rule.value("review"));
    if (review.isEmpty()) rule.remove("review");
    else {
        if (cause != "breach") fail("备份中仅主动失守的国策可以包含复盘。");
        rule["review"] = review;
    }
    return rule;
}

void validateLinks(const QJsonArray &rules, const QJsonArray &categories) {
    QHash<QString, QJsonObject> byId;
    QSet<QString> days, categoryIds, incidents;
    for (const auto &item : categories) categoryIds.insert(item.toObject().value("id").toString());
    for (const auto &item : rules) {
        const auto rule = item.toObject();
        const auto id = rule.value("id").toString();
        const auto day = rule.value("day").toString();
        if (byId.contains(id)) fail("备份中有重复的国策编号。");
        if (days.contains(day)) fail("备份中同一天新增了多项国策。");
        byId.insert(id, rule);
        days.insert(day);
    }
    QHash<QString, QStringList> dependents;
    QHash<QString, int> remaining;
    QStringList ready;
    for (auto it = byId.constBegin(); it != byId.constEnd(); ++it) {
        const auto &id = it.key();
        const auto &rule = it.value();
        const auto parentId = rule.value("parentId");
        const auto retryOf = rule.value("retryOf");
        const auto category = rule.value("categoryId");
        const auto incident = rule.value("incidentId");
        const auto parent = byId.value(parentId.toString());
        if (!category.isNull() && !categoryIds.contains(category.toString())) fail("备份中的国策引用了不存在的类别。");
        if (!parentId.isNull()) {
            if (parent.isEmpty() || (rule.value("archivedAt").isNull() && !parent.value("archivedAt").isNull()))
                fail("备份中的上级国策缺失或已失效。");
            if (parent.value("categoryId") != category) fail("备份中有父子国策的类别不一致。");
        }
        if (!retryOf.isNull() && !byId.value(retryOf.toString()).value("archivedAt").isString())
            fail("备份中的重试来源无效。");
        if (rule.value("cause") == "ancestor" && (parent.isEmpty() || parent.value("incidentId") != incident ||
                parent.value("archivedAt") != rule.value("archivedAt")))
            fail("随上级撤回的国策缺少对应的剪枝记录。");
        if (rule.value("cause") == "breach") {
            if (incidents.contains(incident.toString())) fail("一次剪枝只能有一项主动失守的国策。");
            incidents.insert(incident.toString());
        }
        int count = 0;
        for (const auto &source : {parentId, retryOf}) {
            if (!source.isNull()) {
                dependents[source.toString()].append(id);
                ++count;
            }
        }
        remaining[id] = count;
        if (!count) ready.append(id);
    }
    for (int i = 0; i < ready.size(); ++i)
        for (const auto &child : dependents.value(ready.at(i)))
            if (--remaining[child] == 0) ready.append(child);
    if (ready.size() != rules.size()) fail("备份中的国策关系形成了循环。");
}

QSet<QString> branchIds(const QJsonArray &rules, const QString &id, bool archived) {
    QHash<QString, QStringList> children;
    bool rootExists = false;
    for (const auto &item : rules) {
        const auto rule = item.toObject();
        if (!archived && !rule.value("archivedAt").isNull()) continue;
        const auto key = rule.value("id").toString();
        if (id == key) rootExists = true;
        if (rule.value("parentId").isString()) children[rule.value("parentId").toString()].append(key);
    }
    QSet<QString> affected;
    if (!rootExists) return affected;
    QStringList queue{id};
    for (int i = 0; i < queue.size(); ++i) {
        const auto next = queue.at(i);
        affected.insert(next);
        queue.append(children.value(next));
    }
    return affected;
}

void saveFile(const QString &path, const QByteArray &bytes) {
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
        fail("保存档案失败：" + file.errorString());
}
}

Store::Store(QString filePath) : path(QFileInfo(filePath).absoluteFilePath()) {}

QJsonObject Store::decode(const QByteArray &bytes) {
    QJsonParseError error;
    const auto doc = QJsonDocument::fromJson(bytes, &error);
    if (error.error != QJsonParseError::NoError) fail("无法读取 JSON：" + error.errorString());
    auto state = doc.object();
    const auto version = state.value("version").toInt();
    if (version < 1 || version > 3 || !state.value("rules").isArray()) fail("不支持的备份格式或版本。");
    const auto categories = version == 1 ? emptyTree().value("categories").toArray() : readCategories(state.value("categories"));
    QJsonArray rules;
    for (const auto &item : state.value("rules").toArray()) rules.append(readRule(item.toObject(), version == 1));
    validateLinks(rules, categories);
    state["version"] = 3;
    state["rules"] = rules;
    state["categories"] = categories;
    return state;
}

QJsonObject Store::transact(const std::function<void(QJsonObject &)> &change) {
    if (!QDir().mkpath(QFileInfo(path).absolutePath())) fail("无法创建每日国策数据目录。");
    QLockFile lock(path + ".lock");
    // Large user archives may take time. Only recover a lock left by a dead owner.
    lock.setStaleLockTime(0);
    if (!lock.tryLock(3000)) fail("档案暂时无法锁定，请稍后再试。");
    QJsonObject state;
    QFile existing(path);
    if (existing.exists()) {
        if (!existing.open(QIODevice::ReadOnly)) fail("读取档案失败：" + existing.errorString());
        const auto bytes = existing.readAll();
        if (existing.error() != QFileDevice::NoError) fail("读取档案失败：" + existing.errorString());
        existing.close();
        state = decode(bytes);
    } else state = emptyTree();
    if (change) {
        change(state);
        saveFile(path, QJsonDocument(state).toJson());
    }
    return state;
}

QJsonObject Store::load() {
    return transact();
}

QJsonObject Store::importBackup(const QByteArray &bytes, const QJsonObject &expected, bool requireNewFile) {
    const auto incoming = decode(bytes);
    return transact([&](QJsonObject &state) {
        if (requireNewFile && QFile::exists(path)) fail("本机已有桌面档案，请在「数据备份」核对后导入。");
        if (state != expected) fail("预览期间本机档案已更新，请重新核对后再导入。");
        if (QFile::exists(path) && state != incoming) {
            const auto stamp = QDateTime::currentDateTimeUtc().toString("yyyyMMdd-HHmmsszzz");
            const auto backupPath = path + ".before-import-" + stamp + "-" + QUuid::createUuid().toString(QUuid::WithoutBraces) + ".json";
            saveFile(backupPath, QJsonDocument(state).toJson());
        }
        state = incoming;
    });
}

QJsonObject Store::addRule(QJsonObject input) {
    return transact([&](QJsonObject &state) {
        auto rules = state.value("rules").toArray();
        const auto now = QDateTime::currentDateTime();
        const auto day = now.date().toString(Qt::ISODate);
        for (const auto &item : rules)
            if (item.toObject().value("day") == day) fail("今天已新增过国策，明天可以再加。");
        QJsonObject rule;
        for (const auto field : {"title", "trigger", "action"}) {
            const auto text = trimText(input.value(field).toString());
            if (text.isEmpty()) fail("请填写国策名称、触发时机和具体行动。");
            rule[field] = text;
        }
        if (!validBadge(input.value("badge"))) fail("请选择有效的徽章。");
        const auto parentId = input.value("parentId");
        auto category = input.value("categoryId");
        if (!parentId.isNull()) {
            const int pos = findId(rules, parentId);
            if (pos < 0 || !rules.at(pos).toObject().value("archivedAt").isNull())
                fail("选中的上级国策已失效，请重新选择。");
            const auto inherited = rules.at(pos).toObject().value("categoryId");
            if (!category.isUndefined() && category != inherited) fail("子国策须沿用上级国策的类别，请重新确认。");
            category = inherited;
        }
        if (category.isUndefined()) category = QJsonValue::Null;
        requireCategory(state.value("categories").toArray(), category);
        auto retry = input.value("retryOf");
        if (retry.isUndefined()) retry = QJsonValue::Null;
        if (!retry.isNull()) {
            const int pos = findId(rules, retry);
            if (pos < 0 || rules.at(pos).toObject().value("archivedAt").isNull()) fail("所选的重试记录已失效。");
        }
        const auto id = QUuid::createUuid().toString(QUuid::WithoutBraces);
        if (findId(rules, id) >= 0) fail("国策编号重复，请重试。");
        rule["id"] = id;
        rule["createdAt"] = now.toUTC().toString(Qt::ISODateWithMs);
        rule["day"] = day;
        rule["badge"] = input.value("badge");
        rule["parentId"] = parentId;
        rule["categoryId"] = category;
        rule["retryOf"] = retry;
        for (const auto field : {"archivedAt", "cause", "incidentId"}) rule[field] = QJsonValue::Null;
        rules.append(rule);
        state["rules"] = rules;
    });
}

QJsonObject Store::prune(QString id, QStringList expectedIds, QString reason, QString improvement) {
    return transact([&](QJsonObject &state) {
        auto rules = state.value("rules").toArray();
        const auto affected = branchIds(rules, id, false);
        if (affected.isEmpty()) fail("这项国策已退出当前树。");
        if (affected.size() != expectedIds.size() || affected != QSet<QString>(expectedIds.cbegin(), expectedIds.cend()))
            fail("这条分支已有变化，请重新查看受影响的国策后再确认。");
        const auto archivedAt = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
        const auto review = normalizeReview(QJsonObject{{"reason", reason}, {"improvement", improvement}});
        for (int i = 0; i < rules.size(); ++i) {
            auto rule = rules.at(i).toObject();
            const auto key = rule.value("id").toString();
            if (!affected.contains(key)) continue;
            rule["archivedAt"] = archivedAt;
            rule["incidentId"] = id;
            rule["cause"] = key == id ? "breach" : "ancestor";
            if (key == id && !review.isEmpty()) rule["review"] = review;
            rules[i] = rule;
        }
        state["rules"] = rules;
    });
}

QJsonObject Store::saveReview(QString id, QJsonObject review, QJsonValue expected) {
    return transact([&](QJsonObject &state) {
        auto rules = state.value("rules").toArray();
        const int pos = findId(rules, id);
        if (pos < 0) fail("找不到这条失守记录。");
        auto rule = rules.at(pos).toObject();
        if (rule.value("cause") != "breach") fail("仅可为主动失守的国策保存复盘。");
        const auto old = expected.isNull() ? QJsonObject{} : normalizeReview(expected);
        if (old != rule.value("review").toObject()) fail("这条复盘已在别处更新，请重新打开并核对后再保存。");
        const auto next = normalizeReview(review);
        if (next.isEmpty()) rule.remove("review");
        else rule["review"] = next;
        rules[pos] = rule;
        state["rules"] = rules;
    });
}

QJsonObject Store::addCategory(QString name) {
    return transact([&](QJsonObject &state) {
        auto categories = state.value("categories").toArray();
        categories.append(QJsonObject{{"id", QUuid::createUuid().toString(QUuid::WithoutBraces)}, {"name", name}});
        state["categories"] = readCategories(categories);
    });
}

QJsonObject Store::renameCategory(QString id, QString name) {
    return transact([&](QJsonObject &state) {
        auto categories = state.value("categories").toArray();
        const int pos = findId(categories, id);
        if (pos < 0) fail("所选类别已不存在，请重新选择。");
        auto category = categories.at(pos).toObject();
        category["name"] = name;
        categories[pos] = category;
        state["categories"] = readCategories(categories);
    });
}

QJsonObject Store::removeCategory(QString id) {
    return transact([&](QJsonObject &state) {
        auto categories = state.value("categories").toArray();
        const int pos = findId(categories, id);
        if (pos < 0) fail("所选类别已不存在，请重新选择。");
        categories.removeAt(pos);
        state["categories"] = categories;
        auto rules = state.value("rules").toArray();
        for (int i = 0; i < rules.size(); ++i) {
            auto rule = rules.at(i).toObject();
            if (rule.value("categoryId") != id) continue;
            rule["categoryId"] = QJsonValue::Null;
            rules[i] = rule;
        }
        state["rules"] = rules;
    });
}

QJsonObject Store::moveBranch(QString id, QJsonValue categoryId) {
    return transact([&](QJsonObject &state) {
        auto rules = state.value("rules").toArray();
        const int pos = findId(rules, id);
        const auto root = pos < 0 ? QJsonObject{} : rules.at(pos).toObject();
        if (root.isEmpty() || !root.value("archivedAt").isNull() || !root.value("parentId").isNull())
            fail("仅可从生效中的顶层国策移动整个分支。");
        requireCategory(state.value("categories").toArray(), categoryId);
        const auto affected = branchIds(rules, id, true);
        for (int i = 0; i < rules.size(); ++i) {
            auto rule = rules.at(i).toObject();
            if (!affected.contains(rule.value("id").toString())) continue;
            rule["categoryId"] = categoryId;
            rules[i] = rule;
        }
        state["rules"] = rules;
    });
}
