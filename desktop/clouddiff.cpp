#include "cloud.h"
#include <QHash>
#include <QJsonArray>
#include <algorithm>

namespace Cloud {
namespace {
struct EntrySet {
    QStringList order;
    QHash<QString, QJsonObject> byId;
    explicit EntrySet(const QJsonArray &array) {
        for (const auto &entry : array) {
            const auto object = entry.toObject();
            const auto id = object.value("id").toString();
            order.append(id);
            byId.insert(id, object);
        }
    }
};

struct Index {
    EntrySet categories;
    EntrySet rules;
    explicit Index(const QJsonObject &state)
        : categories(state.value("categories").toArray()), rules(state.value("rules").toArray()) {}
};

QString value(const Index &index, const QString &key, const QString &raw) {
    if (raw.isEmpty()) return "（无）";
    if (key == "categoryId") return index.categories.byId.value(raw).value("name").toString(raw);
    if (key == "parentId" || key == "incidentId" || key == "retryOf")
        return index.rules.byId.value(raw).value("title").toString(raw);
    if (key == "cause") return raw == "breach" ? "主动失守" : "随上级撤回";
    if (key == "badge") {
        static const QHash<QString,QString> badges{{"standard","旗帜"},{"sun","太阳"},{"moon","月亮"},
                                                   {"book","书本"},{"leaf","枝叶"},{"shield","盾牌"}};
        return badges.value(raw,raw);
    }
    return raw;
}

QString snippet(const QString &text, int mismatch) {
    // Retain the differing part even when two long review paragraphs start with identical text.
    if (text.size() <= 250) return text;
    const int begin = std::max(0, mismatch - 65);
    return (begin ? QString("…") : QString()) + text.mid(begin, 200) +
           (begin + 200 < text.size() ? QString("…") : QString());
}

void append(Differences &out, const QString &title, const QStringList &fields = {}) {
    ++out.count;
    if (out.highlights.size() < 3) out.highlights.append(title);
    if (out.details.size() < 100) out.details.append(fields.isEmpty() ? title : title + "\n" + fields.join("\n"));
}

void compareEntries(Differences &out, const Index &local, const Index &remote, bool categories) {
    const auto &a = categories ? local.categories : local.rules;
    const auto &b = categories ? remote.categories : remote.rules;
    const auto type = categories ? QString("类别") : QString("国策");
    const auto titleKey = categories ? "name" : "title";
    const auto title = [&](const QJsonObject &item) {
        QString text = item.value(titleKey).toString();
        if (text.size() > 48) text = text.left(47) + "…";
        return type + "「" + text + "」";
    };
    const QList<QPair<QString,QString>> fields = categories
        ? QList<QPair<QString,QString>>{{"name","名称"}}
        : QList<QPair<QString,QString>>{{"title","名称"},{"trigger","触发时机"},{"action","具体行动"},
             {"reason","失败原因"},{"improvement","改进计划"},{"categoryId","所属类别"},{"parentId","上级国策"},
             {"cause","撤回原因"},{"archivedAt","归档时间"},{"incidentId","失守来源"},{"retryOf","重试来源"},
             {"day","占用名额日期"},{"createdAt","创建时间"},{"badge","徽章"}};
    QStringList commonA, commonB;
    for (const auto &id : a.order) {
        const auto left = a.byId.value(id);
        if (!b.byId.contains(id)) { append(out, "仅本机有：" + title(left)); continue; }
        commonA.append(id);
        const auto right = b.byId.value(id);
        if (left == right) continue;
        QStringList names, lines;
        for (const auto &field : fields) {
            const auto &key = field.first;
            const bool review = key == "reason" || key == "improvement";
            const auto leftRaw = (review ? left.value("review").toObject() : left).value(key).toString();
            const auto rightRaw = (review ? right.value("review").toObject() : right).value(key).toString();
            if (leftRaw == rightRaw) continue;
            names.append(field.second);
            if (out.details.size() >= 100) continue;
            QString av = value(local, key, leftRaw), bv = value(remote, key, rightRaw);
            if (av == bv) { av += " [" + leftRaw + "]"; bv += " [" + rightRaw + "]"; }
            int mismatch = 0;
            while (mismatch < av.size() && mismatch < bv.size() && av[mismatch] == bv[mismatch]) ++mismatch;
            lines.append(field.second + "\n  本机：" + snippet(av, mismatch) + "\n  云端：" + snippet(bv, mismatch));
        }
        if (!names.isEmpty()) append(out, title(left) + " · " + names.join("、"), lines);
    }
    for (const auto &id : b.order) {
        if (a.byId.contains(id)) commonB.append(id);
        else append(out, "仅云端有：" + title(b.byId.value(id)));
    }
    if (commonA != commonB) append(out, type + "排列顺序不同");
}
}
Differences archiveDifferences(const QJsonObject &localState, const QJsonObject &remoteState) {
    const Index local(localState), remote(remoteState);
    Differences out;
    compareEntries(out, local, remote, true);
    compareEntries(out, local, remote, false);
    return out;
}
}
