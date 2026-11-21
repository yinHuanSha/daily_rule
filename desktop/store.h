#pragma once

#include <QByteArray>
#include <QJsonObject>
#include <QStringList>
#include <functional>

// One v3 archive per user. Each change reloads under an interprocess lock.
class Store {
public:
    explicit Store(QString filePath);
    QString filePath() const { return path; }
    QJsonObject load();
    static QJsonObject decode(const QByteArray &bytes);
    QJsonObject importBackup(const QByteArray &bytes, const QJsonObject &expected, bool requireNewFile = false);
    QJsonObject addRule(QJsonObject input);
    QJsonObject prune(QString id, QStringList expectedIds, QString reason, QString improvement);
    QJsonObject saveReview(QString id, QJsonObject review, QJsonValue expected);
    QJsonObject addCategory(QString name);
    QJsonObject renameCategory(QString id, QString name);
    QJsonObject removeCategory(QString id);
    QJsonObject moveBranch(QString id, QJsonValue categoryId);
private:
    QString path;
    QJsonObject transact(const std::function<void(QJsonObject &)> &change = {});
};
