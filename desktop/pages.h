#pragma once

#include <QJsonObject>
#include <functional>

class Store;
class QWidget;

class Pages {
public:
    static QWidget *history(const QJsonObject &state, Store &store,
                            std::function<void()> changed,
                            std::function<void(QJsonObject)> retry);
    static void categories(QWidget *parent, const QJsonObject &state, Store &store,
                           std::function<void()> changed);
    static QWidget *backups(Store &store, std::function<void()> changed);
    static QWidget *guide();
};
