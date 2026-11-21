#pragma once

#include "cloud.h"
#include <QWidget>
#include <functional>

class QLabel;
class QLineEdit;
class QCheckBox;
class QPushButton;
class Store;

class CloudPage final : public QWidget {
public:
    CloudPage(Store &store, std::function<void()> changed, QWidget *parent = nullptr);
private:
    void configure();
    void updateButtons();
    void run(bool automatic, Cloud::Direction choice = Cloud::Direction::Choose, Cloud::Preview expected = {});
    QString settingsPath;
    QString archivePath;
    QString savedRepo;
    bool savedAuto = false;
    bool working = false;
    bool connected = false;
    QLineEdit *repository;
    QLineEdit *token;
    QCheckBox *automaticBox;
    QPushButton *save;
    QPushButton *sync;
    QPushButton *disconnect;
    QLabel *status;
    std::function<void()> changed;
};
