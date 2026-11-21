#pragma once

#include <QJsonObject>
#include <QSet>
#include <QWidget>
#include <functional>

class Store;
class MapView;
class QComboBox;
class QLabel;
class QPushButton;
class QGraphicsScene;

class TreePage : public QWidget {
public:
    TreePage(Store& store, std::function<void()> changed,
             std::function<void()> manageCategories, QWidget* parent = nullptr);
    void refresh(const QJsonObject& state);
    void retry(const QJsonObject& rule);

private:
    void buildMap(bool fit = true, const QString& focusCategory = {});
    void syncFilters();
    void updateQuota();
    void openRule(QJsonObject rule);
    void addRule(const QString& parentId, const QString& categoryId, QJsonObject retryRecord = {});
    void confirmPrune(QJsonObject rule);
    void moveRule(QJsonObject rule);
    void openCategory(QJsonObject category);
    void apply(const QJsonObject& updated);
    bool available() const;
    const QJsonObject& displayed() const;

    Store& store_;
    std::function<void()> changed_;
    std::function<void()> manageCategories_;
    QJsonObject state_;
    QJsonObject demoState_;
    bool demo_ = false;
    QSet<QString> threatened_;
    QSet<QString> collapsedCategories_;
    QSet<QString> collapsedDemoCategories_;
    MapView* map_;
    QGraphicsScene* scene_;
    QComboBox* filter_;
    QLabel* status_;
    QPushButton* add_;
    QPushButton* demoButton_;
    QPushButton* categories_;
};
