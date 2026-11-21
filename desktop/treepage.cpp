#include "treepage.h"
#include "store.h"

#include <QtWidgets>
#include <algorithm>
#include <cmath>
#include <deque>
#include <exception>
#include <utility>
#include <vector>

namespace {
QString field(const QJsonObject& rule, const char* name) {
    return rule.value(name).toString();
}

QJsonValue link(const QString& id) {
    return id.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(id);
}

QJsonObject byId(const QJsonArray& entries, const QString& id) {
    for (const auto& item : entries)
        if (field(item.toObject(), "id") == id) return item.toObject();
    return {};
}

QVector<QJsonObject> activeRules(const QJsonObject& state) {
    QVector<QJsonObject> active;
    for (const auto& item : state.value("rules").toArray()) {
        const auto rule = item.toObject();
        if (rule.value("archivedAt").isNull()) active.append(rule);
    }
    return active;
}

QJsonObject exampleState() {
    QJsonArray categories;
    for (const auto& pair : QVector<QPair<QString, QString>>{
             {"life", "生活"}, {"study", "学习"}, {"work", "工作"}})
        categories.append(QJsonObject{{"id", pair.first}, {"name", pair.second}});
    QJsonArray rules;
    auto rule = [&](QString id, QString parent, QString category, QString title,
                    QString badge, QString trigger, QString action) {
        rules.append(QJsonObject{{"id", id}, {"parentId", link(parent)}, {"categoryId", category},
                                 {"title", title}, {"badge", badge}, {"trigger", trigger},
                                 {"action", action}, {"archivedAt", QJsonValue::Null}});
    };
    rule("base", {}, "life", "晨间整备", "standard", "早晨起床、双脚落地时", "把被子叠好，打开窗帘。");
    rule("sun", "base", "life", "无屏早餐", "sun", "坐下来吃早餐前", "把手机放在餐桌以外，直到吃完。");
    rule("book", {}, "study", "书桌就绪", "book", "第一次坐到书桌前", "收起杂物，只留下今天要用的书和笔。");
    rule("read", "book", "study", "晨读一页", "leaf", "书桌整理完毕时", "翻开正在读的书，至少读完一页。");
    rule("plan", {}, "work", "上班先定一事", "shield", "到工位打开电脑后", "在便签上写下今天最重要的一件事。");
    rule("close", "plan", "work", "收工留个起点", "moon", "下班合上电脑之前", "在便签背面写好明早能接着做的第一个动作。");
    return {{"categories", categories}, {"rules", rules}};
}

QString emblemPath(const QString& badge) {
    return ":/emblems/" + badge + ".png";
}

QLabel* plain(const QString& text) {
    auto* label = new QLabel;
    label->setTextFormat(Qt::PlainText);
    label->setWordWrap(true);
    label->setText(text);
    label->setTextInteractionFlags(Qt::TextSelectableByMouse);
    return label;
}

QPlainTextEdit* textBox(QString initial = {}, QString placeholder = {}) {
    auto* edit = new QPlainTextEdit;
    edit->setPlainText(initial);
    edit->setPlaceholderText(placeholder);
    edit->setFixedHeight(62);
    edit->setTabChangesFocus(true);
    return edit;
}

void fillCategories(QComboBox* box, const QJsonObject& state, const QString& chosen) {
    box->addItem("未分类", QString());
    for (const auto& item : state.value("categories").toArray()) {
        const auto category = item.toObject();
        box->addItem(field(category, "name"), field(category, "id"));
    }
    box->setCurrentIndex(std::max(0, box->findData(chosen)));
}

void failure(QWidget* parent, const std::exception& error) {
    QMessageBox::warning(parent, "操作未完成", QString::fromUtf8(error.what()));
}

QDialogButtonBox* dialogActions(QDialog& dialog, QBoxLayout* layout, const QString& acceptText) {
    auto* buttons = new QDialogButtonBox;
    buttons->addButton("取消", QDialogButtonBox::RejectRole);
    buttons->addButton(acceptText, QDialogButtonBox::AcceptRole);
    QObject::connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    layout->addWidget(buttons);
    return buttons;
}

enum class PinKind { Root, Category, Rule };

class Pin final : public QGraphicsItem {
public:
    Pin(PinKind kind, QString title, QString badge, bool threatened, std::function<void()> clicked,
        bool collapsed, const std::function<void()>& details)
        : kind_(kind), icon_(kind == PinKind::Rule ? QPixmap(emblemPath(badge)) : QPixmap()),
          threatened_(threatened), clicked_(std::move(clicked)), foldable_(bool(details)), collapsed_(collapsed) {
        setAcceptHoverEvents(true);
        setFlag(ItemIsFocusable);
        setCursor(Qt::PointingHandCursor);
        setToolTip(title);
        if (kind == PinKind::Root) {
            face_ = QRectF(-15, 0, 30, 30);
            return;
        }

        const bool rule = kind == PinKind::Rule;
        const qreal textLeft = rule ? 69 : 32;
        const qreal textRight = foldable_ ? 37 : rule ? 16 : 18;
        QFont font = QApplication::font();
        font.setPixelSize(rule ? 15 : 14);
        font.setWeight(rule ? QFont::Medium : QFont::DemiBold);
        // Lay out and paint the same shaped lines, including punctuation and mixed scripts.
        text_.setText(QString(title).replace('\n', QChar::LineSeparator));
        text_.setFont(font);
        QTextOption option;
        option.setWrapMode(QTextOption::WrapAtWordBoundaryOrAnywhere);
        text_.setTextOption(option);
        text_.setCacheEnabled(true);
        const qreal width = std::clamp(std::ceil(QFontMetricsF(font).horizontalAdvance(title)) +
                                       textLeft + textRight, rule ? 158.0 : 102.0, rule ? 258.0 : 190.0);
        text_.beginLayout();
        qreal textHeight = 0;
        while (true) {
            auto line = text_.createLine();
            if (!line.isValid()) break;
            line.setLineWidth(width - textLeft - textRight);
            line.setPosition({0, textHeight});
            textHeight += line.height() + 2;
        }
        text_.endLayout();
        textHeight = std::max(0.0, textHeight - 2);
        const qreal height = std::max(rule ? 64.0 : 34.0, textHeight + (rule ? 24 : 12));
        face_ = QRectF(-width / 2, 0, width, height);
        textOrigin_ = QPointF(face_.left() + textLeft, (height - textHeight) / 2);
        if (foldable_) {
            auto* button = new QToolButton;
            button->setText("⋯");
            button->setAccessibleName(title + "的类别详情");
            button->setToolTip(title + " · 类别详情");
            button->setCursor(Qt::PointingHandCursor);
            button->setFocusPolicy(Qt::StrongFocus);
            button->setFixedSize(28, 26);
            button->setStyleSheet("QToolButton {background:transparent; color:#fffbed; border:0; "
                                  "border-left:1px solid #758b78; font-size:16px; padding:0;}"
                                  "QToolButton:hover,QToolButton:focus {background:#53745c;}");
            auto* proxy = new QGraphicsProxyWidget(this);
            proxy->setWidget(button);
            proxy->setPos(face_.right() - 31, (height - button->height()) / 2);
            QObject::connect(button, &QToolButton::clicked, button, details);
        }
    }
    QRectF boundingRect() const override { return face_.adjusted(-2, -2, 2, 4); }
    const QRectF& face() const { return face_; }

    void paint(QPainter* p, const QStyleOptionGraphicsItem* style, QWidget*) override {
        p->setRenderHints(QPainter::Antialiasing | QPainter::TextAntialiasing | QPainter::SmoothPixmapTransform);
        const bool hot = style->state.testFlag(QStyle::State_MouseOver) || hasFocus();
        if (kind_ == PinKind::Root) {
            const QPolygonF diamond(QVector<QPointF>{{0, 0}, {15, 15}, {0, 30}, {-15, 15}});
            p->setPen(QPen(hot ? QColor("#436952") : QColor("#9f9164"), hot ? 2 : 1.2));
            p->setBrush(QColor("#faf6e7"));
            p->drawPolygon(diamond);
            p->setPen(Qt::NoPen);
            p->setBrush(QColor("#48624e"));
            p->drawPolygon(QPolygonF(QVector<QPointF>{{0, 8}, {7, 15}, {0, 22}, {-7, 15}}));
            return;
        }

        const bool rule = kind_ == PinKind::Rule;
        const qreal radius = rule ? 9 : 6;
        p->setPen(Qt::NoPen);
        p->setBrush(QColor(71, 66, 42, 22));
        p->drawRoundedRect(face_.translated(0, 2), radius, radius);
        const QColor border = threatened_ ? QColor("#a75540") : hot ? QColor("#486e54") :
                              rule ? QColor("#c2b897") : QColor("#405e4b");
        const QColor fill = rule ? (threatened_ ? QColor("#fff0e7") : QColor("#fffdf5")) :
                                   (hot ? QColor("#466b54") : QColor("#324f40"));
        p->setPen(QPen(border, hot || threatened_ ? 2 : 1));
        p->setBrush(fill);
        p->drawRoundedRect(face_, radius, radius);

        const qreal left = face_.left(), middle = face_.center().y();
        if (rule) {
            p->drawPixmap(QRectF(left + 5, middle - 23.4, 54, 46.8), icon_, icon_.rect());
            p->setPen(QPen(QColor("#dfd8c2"), 1));
            p->drawLine(QPointF(left + 59, middle - 13), QPointF(left + 59, middle + 13));
        } else {
            p->setPen(Qt::NoPen);
            p->setBrush(QColor("#dbcb99"));
            const qreal x = left + 18;
            if (foldable_) {
                const QPolygonF arrow = collapsed_
                    ? QPolygonF(QVector<QPointF>{{x-2, middle-5}, {x+3, middle}, {x-2, middle+5}})
                    : QPolygonF(QVector<QPointF>{{x-5, middle-2}, {x+5, middle-2}, {x, middle+3}});
                p->drawPolygon(arrow);
            } else {
                p->drawPolygon(QPolygonF(QVector<QPointF>{{x, middle-4}, {x+4, middle}, {x, middle+4}, {x-4, middle}}));
            }
        }
        p->setPen(rule ? QColor("#253f32") : QColor("#fffbed"));
        text_.draw(p, textOrigin_);
    }
protected:
    void mousePressEvent(QGraphicsSceneMouseEvent* event) override { event->accept(); }
    void mouseReleaseEvent(QGraphicsSceneMouseEvent* event) override {
        if (event->button() == Qt::LeftButton && boundingRect().contains(event->pos())) clicked_();
        event->accept();
    }
    void keyPressEvent(QKeyEvent* event) override {
        if (event->key() == Qt::Key_Return || event->key() == Qt::Key_Space) clicked_();
        else QGraphicsItem::keyPressEvent(event);
    }
private:
    PinKind kind_;
    QPixmap icon_;
    bool threatened_;
    std::function<void()> clicked_;
    bool foldable_;
    bool collapsed_;
    QRectF face_;
    QTextLayout text_;
    QPointF textOrigin_;
};

struct Branch {
    PinKind kind;
    QString key;
    QString parent;
    QJsonObject data;
    QVector<int> children;
    Pin* pin = nullptr;
    int depth = 0;
    qreal x = 0;
};

// The left and right edges occupied at each depth. An empty category only
// takes space on its own row; a wide group of cards can fan out beneath it.
struct BranchContour {
    std::deque<std::pair<qreal, qreal>> rows;
    qreal offset = 0;

    qreal placeSibling(BranchContour sibling) {
        constexpr qreal gap = 24;
        const auto shared = std::min(rows.size(), sibling.rows.size());
        qreal x = 0;
        for (size_t d = 0; d < shared; ++d)
            x = std::max(x, rows[d].second + offset + gap - (sibling.rows[d].first + sibling.offset));
        sibling.offset += x;
        // Reuse the deeper contour so adding a child to a long chain is cheap.
        if (rows.size() >= sibling.rows.size()) {
            for (size_t d = 0; d < shared; ++d)
                rows[d].second = sibling.rows[d].second + sibling.offset - offset;
        } else {
            for (size_t d = 0; d < shared; ++d)
                sibling.rows[d].first = rows[d].first + offset - sibling.offset;
            *this = std::move(sibling);
        }
        return x;
    }
};

class Banner final : public QFrame {
public:
    explicit Banner(QWidget* parent) : QFrame(parent), background_(":/expedition.jpg") {}
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);
        p.fillRect(rect(), QColor("#233a32"));
        if (!background_.isNull()) {
            p.setRenderHint(QPainter::SmoothPixmapTransform);
            const auto scaled = background_.scaled(size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
            p.drawPixmap((width() - scaled.width()) / 2, (height() - scaled.height()) / 2, scaled);
        }
    }
private:
    QPixmap background_;
};
} // namespace

class MapView final : public QGraphicsView {
public:
    MapView(QGraphicsScene* scene, QWidget* parent) : QGraphicsView(scene, parent) {
        setRenderHints(QPainter::Antialiasing | QPainter::SmoothPixmapTransform);
        setDragMode(ScrollHandDrag);
        setTransformationAnchor(AnchorUnderMouse);
        setAlignment(Qt::AlignCenter);
        setBackgroundBrush(QColor("#f1eddc"));
        setAccessibleName("国策树沙盘");
    }
    bool autoFits() const { return automatic_; }
    void fit() {
        const QRectF bounds = sceneRect();
        if (bounds.isEmpty() || viewport()->width() < 10) return;
        resetTransform();
        const qreal factor = std::min({(viewport()->width()-12.) / bounds.width(),
                                       (viewport()->height()-12.) / bounds.height(), 1.25});
        if (factor > 0) scale(factor, factor);
        centerOn(bounds.center());
        automatic_ = true;
    }
    void zoom(qreal ratio) {
        if (ratio > 1 && transform().m11() * ratio > 4) return;
        if (ratio < 1 && transform().m11() * ratio < 0.005) return;
        automatic_ = false;
        scale(ratio, ratio);
    }
protected:
    void wheelEvent(QWheelEvent* event) override {
        if (event->angleDelta().y() != 0) zoom(event->angleDelta().y() > 0 ? 1.16 : 1/1.16);
        event->accept();
    }
    void resizeEvent(QResizeEvent* event) override {
        QGraphicsView::resizeEvent(event);
        if (automatic_) fit();
    }
private:
    bool automatic_ = true;
};

TreePage::TreePage(Store& store, std::function<void()> changed, std::function<void()> manageCategories, QWidget* parent)
    : QWidget(parent), store_(store), changed_(std::move(changed)), manageCategories_(std::move(manageCategories)),
      demoState_(exampleState()) {
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(12, 12, 12, 12);
    layout->setSpacing(10);
    auto* banner = new Banner(this);
    banner->setMinimumHeight(94);
    auto* bannerLayout = new QVBoxLayout(banner);
    bannerLayout->setContentsMargins(22, 12, 22, 12);
    auto* heading = new QLabel("国策指挥台");
    heading->setStyleSheet("color:#f9efd2;font-size:25px;font-weight:bold;background:transparent");
    status_ = new QLabel;
    status_->setStyleSheet("color:#fff5d8;font-size:13px;background:transparent");
    bannerLayout->addWidget(heading);
    bannerLayout->addWidget(status_);
    layout->addWidget(banner);
    auto* tools = new QHBoxLayout;
    add_ = new QPushButton("新建分支");
    categories_ = new QPushButton("类别管理");
    demoButton_ = new QPushButton("示例图");
    demoButton_->setCheckable(true);
    tools->addWidget(add_);
    tools->addWidget(categories_);
    tools->addStretch();
    tools->addWidget(demoButton_);
    layout->addLayout(tools);
    scene_ = new QGraphicsScene(this);
    map_ = new MapView(scene_, this);
    map_->setMinimumHeight(160);
    layout->addWidget(map_, 1);
    auto* mapTools = new QHBoxLayout;
    filter_ = new QComboBox;
    filter_->setAccessibleName("类别筛选");
    filter_->setMaximumWidth(230);
    mapTools->addWidget(filter_);
    mapTools->addStretch();
    auto* minus = new QPushButton("−");
    auto* plus = new QPushButton("+");
    minus->setAccessibleName("缩小");
    plus->setAccessibleName("放大");
    minus->setFixedWidth(40);
    plus->setFixedWidth(40);
    auto* fit = new QPushButton("适应全图");
    mapTools->addWidget(minus);
    mapTools->addWidget(plus);
    mapTools->addWidget(fit);
    layout->addLayout(mapTools);
    connect(add_, &QPushButton::clicked, this, [this] { addRule({}, filter_->currentData().toString()); });
    connect(categories_, &QPushButton::clicked, this, [this] { manageCategories_(); });
    connect(demoButton_, &QPushButton::toggled, this, [this](bool enabled) {
        demo_ = enabled;
        demoButton_->setText(enabled ? "返回我的国策" : "示例图");
        { QSignalBlocker blocker(filter_); filter_->setCurrentIndex(0); }
        syncFilters();
        updateQuota();
        buildMap();
    });
    connect(filter_, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int) { buildMap(); });
    connect(minus, &QPushButton::clicked, this, [this] { map_->zoom(0.8); });
    connect(plus, &QPushButton::clicked, this, [this] { map_->zoom(1.25); });
    connect(fit, &QPushButton::clicked, this, [this] { map_->fit(); });
    auto* clock = new QTimer(this);
    connect(clock, &QTimer::timeout, this, [this] { updateQuota(); });
    clock->start(15000);
}

bool TreePage::available() const {
    const QString today = QDate::currentDate().toString(Qt::ISODate);
    for (const auto& item : state_.value("rules").toArray())
        if (field(item.toObject(), "day") == today) return false;
    return true;
}

void TreePage::updateQuota() {
    const bool quota = available();
    add_->setEnabled(!demo_ && quota);
    categories_->setEnabled(!demo_);
    const int count = activeRules(displayed()).size();
    const auto overview = QString("%1 项生效国策  ·  %2 个类别")
        .arg(count).arg(displayed().value("categories").toArray().size());
    status_->setText(demo_ ? "示例图  ·  " + overview :
        overview + (quota ? "  ·  今日还可新增 1 项" : "  ·  今日新增名额已用完"));
}

const QJsonObject& TreePage::displayed() const { return demo_ ? demoState_ : state_; }

void TreePage::refresh(const QJsonObject& state) {
    if (state == state_ && filter_->count() > 0) { updateQuota(); return; }
    state_ = state;
    QSet<QString> activeCategories;
    for (const auto& rule : activeRules(state_)) activeCategories.insert(field(rule, "categoryId"));
    collapsedCategories_.intersect(activeCategories);
    syncFilters();
    updateQuota();
    buildMap();
}

void TreePage::syncFilters() {
    QSignalBlocker blocker(filter_);
    const bool all = filter_->currentIndex() <= 0;
    const auto old = filter_->currentData();
    filter_->clear();
    filter_->addItem("全部类别");
    fillCategories(filter_, displayed(), {});
    filter_->setCurrentIndex(all ? 0 : std::max(0, filter_->findData(old)));
}

void TreePage::apply(const QJsonObject& updated) {
    refresh(updated);
    changed_();
}

void TreePage::buildMap(bool fit, const QString& focusCategory) {
    const auto& collapsed = demo_ ? collapsedDemoCategories_ : collapsedCategories_;
    QSet<QString> categoriesWithRules;
    const bool all = filter_->currentIndex() <= 0;
    const QString only = filter_->currentData().toString();
    QVector<Branch> nodes{{PinKind::Root, "root", {}, {}, {}}};
    for (const auto& item : displayed().value("categories").toArray()) {
        const auto category = item.toObject();
        const auto id = field(category, "id");
        if (all || only == id)
            nodes.append({PinKind::Category, "cat/" + id, "root", category, {}});
    }
    for (const auto& rule : activeRules(displayed())) {
        const auto category = field(rule, "categoryId");
        if (!all && only != category) continue;
        categoriesWithRules.insert(category);
        if (collapsed.contains(category)) continue;
        QString parent = field(rule, "parentId");
        const QString key = !parent.isEmpty() ? "rule/" + parent : category.isEmpty() ? QString("root") : "cat/" + category;
        nodes.append({PinKind::Rule, "rule/" + field(rule, "id"), key, rule, {}});
    }
    QHash<QString, int> indices;
    for (int i = 0; i < nodes.size(); ++i) indices.insert(nodes[i].key, i);
    for (int i = 1; i < nodes.size(); ++i) nodes[indices.value(nodes[i].parent)].children.append(i);
    scene_->clear();
    for (auto& node : nodes) {
        const bool marked = node.kind == PinKind::Rule && threatened_.contains(field(node.data, "id"));
        const auto title = node.kind == PinKind::Root ? QString("空根 · 类别管理") :
                           field(node.data, node.kind == PinKind::Rule ? "title" : "name");
        auto open = [this, kind=node.kind, data=node.data, example=demo_] {
            QTimer::singleShot(0, this, [=] {
                if (example != demo_) return;
                if (kind == PinKind::Rule) openRule(data);
                else if (kind == PinKind::Category) openCategory(data);
                else if (!demo_) manageCategories_();
                else {
                    const auto categories = demoState_.value("categories").toArray();
                    QStringList names;
                    for (const auto& entry : categories) names.append(field(entry.toObject(), "name"));
                    bool chosen = false;
                    const auto name = QInputDialog::getItem(this, "示例图的国策类别", "选择类别",
                                                           names, 0, false, &chosen);
                    if (chosen) openCategory(categories.at(names.indexOf(name)).toObject());
                }
            });
        };
        const QString id = field(node.data, "id");
        const bool foldable = node.kind == PinKind::Category && categoriesWithRules.contains(id);
        std::function<void()> activate = open;
        std::function<void()> details;
        if (foldable) {
            details = open;
            activate = [this, id, example=demo_] {
                // Redrawing deletes the clicked item; finish its input event first.
                QTimer::singleShot(0, this, [this, id, example] {
                    if (example != demo_) return;
                    auto& folded = demo_ ? collapsedDemoCategories_ : collapsedCategories_;
                    if (!folded.remove(id)) folded.insert(id);
                    buildMap(map_->autoFits(), id);
                });
            };
        }
        node.pin = new Pin(node.kind, title, field(node.data, "badge"), marked, std::move(activate),
                           foldable && collapsed.contains(id), details);
        scene_->addItem(node.pin);
    }

    constexpr qreal levelGap = 38;
    QVector<int> order{0};
    QVector<qreal> rowHeight;
    for (int k = 0; k < order.size(); ++k) {
        auto& node = nodes[order[k]];
        if (node.depth == rowHeight.size()) rowHeight.append(0);
        rowHeight[node.depth] = std::max(rowHeight[node.depth], node.pin->face().height());
        for (int child : node.children) {
            nodes[child].depth = node.depth + 1;
            order.append(child);
        }
    }
    std::vector<BranchContour> contours(nodes.size());
    for (auto it = order.crbegin(); it != order.crend(); ++it) {
        const auto& node = nodes[*it];
        auto& contour = contours[*it];
        if (!node.children.isEmpty()) {
            contour = std::move(contours[node.children.first()]);
            for (int c = 1; c < node.children.size(); ++c) {
                const int child = node.children[c];
                nodes[child].x = contour.placeSibling(std::move(contours[child]));
            }
            const qreal middle = nodes[node.children.last()].x / 2;
            for (int child : node.children) nodes[child].x -= middle;
            contour.offset -= middle;
        }
        const auto bounds = node.pin->boundingRect();
        contour.rows.emplace_front(bounds.left() - contour.offset, bounds.right() - contour.offset);
    }
    QVector<qreal> rowTop{0};
    for (qreal height : rowHeight) rowTop.append(rowTop.last() + height + levelGap);
    for (int i : order) {
        auto& node = nodes[i];
        const qreal top = rowTop[node.depth];
        node.pin->setPos(node.x, top);
        for (int child : node.children) {
            auto& branch = nodes[child];
            branch.x += node.x;
            const qreal nextTop = rowTop[branch.depth];
            const qreal busY = nextTop - levelGap / 2;
            QPainterPath line(QPointF(node.x, top + node.pin->face().height()));
            line.lineTo(node.x, busY);
            line.lineTo(branch.x, busY);
            line.lineTo(branch.x, nextTop);
            const bool marked = threatened_.contains(field(branch.data, "id")) && branch.kind == PinKind::Rule;
            scene_->addPath(line, QPen(QColor(marked ? "#ac6046" : "#aba483"), 1.4,
                                      Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin))->setZValue(-1);
        }
    }
    scene_->setSceneRect(scene_->itemsBoundingRect().adjusted(-28, -16, 28, 20));
    if (fit) map_->fit();
    if (!focusCategory.isEmpty() && indices.contains("cat/" + focusCategory)) {
        auto* category = nodes[indices.value("cat/" + focusCategory)].pin;
        category->setFocus(Qt::OtherFocusReason);
        if (!fit) map_->ensureVisible(category);
    }
}

void TreePage::openCategory(QJsonObject category) {
    QDialog dialog(this);
    dialog.setWindowTitle(field(category, "name"));
    auto* layout = new QVBoxLayout(&dialog);
    int count = 0;
    QVector<QJsonObject> roots;
    for (const auto& rule : activeRules(displayed())) {
        if (rule.value("categoryId") != category.value("id")) continue;
        ++count;
        if (rule.value("parentId").isNull()) roots.append(rule);
    }
    layout->addWidget(plain(QString("%1 项生效国策  ·  %2 条分支").arg(count).arg(roots.size())));
    enum Choice { Add = 2, Manage, Detail };
    auto* list = new QListWidget;
    list->setAccessibleName("分支国策");
    layout->addWidget(list);
    list->setVisible(!roots.isEmpty());
    for (const auto& rule : roots)
        list->addItem(new QListWidgetItem(QIcon(emblemPath(field(rule,"badge"))), field(rule,"title")));
    connect(list, &QListWidget::itemActivated, &dialog, [&](QListWidgetItem*) { dialog.done(Detail); });
    if (!roots.isEmpty()) {
        list->setCurrentRow(0);
        auto* view = new QPushButton("查看选中国策");
        layout->addWidget(view);
        connect(view, &QPushButton::clicked, &dialog, [&] { dialog.done(Detail); });
    }
    if (!demo_) {
        auto* add = new QPushButton("在此类别新建国策");
        add->setEnabled(available());
        if (!available()) layout->addWidget(plain("今日新增名额已用完。"));
        layout->addWidget(add);
        connect(add, &QPushButton::clicked, &dialog, [&] { dialog.done(Add); });
        auto* manage = new QPushButton("类别管理");
        layout->addWidget(manage);
        connect(manage, &QPushButton::clicked, &dialog, [&] { dialog.done(Manage); });
    }
    auto* close = new QPushButton("关闭");
    layout->addWidget(close);
    connect(close, &QPushButton::clicked, &dialog, &QDialog::reject);
    const int result = dialog.exec();
    if (result == Add && !demo_) addRule({}, field(category, "id"));
    if (result == Manage && !demo_) manageCategories_();
    if (result == Detail && list->currentRow() >= 0) openRule(roots.at(list->currentRow()));
}

void TreePage::openRule(QJsonObject rule) {
    QDialog dialog(this);
    dialog.setWindowTitle(demo_ ? "示例国策详情" : "国策详情");
    dialog.resize(440, 330);
    auto* layout = new QVBoxLayout(&dialog);
    auto* titleRow = new QHBoxLayout;
    auto* medal = new QLabel;
    medal->setPixmap(QPixmap(emblemPath(field(rule, "badge"))).scaled(65, 58, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    titleRow->addWidget(medal);
    auto* title = plain(field(rule, "title"));
    title->setStyleSheet("font-size:21px;font-weight:bold;color:#324b39");
    titleRow->addWidget(title, 1);
    layout->addLayout(titleRow);
    auto* info = new QFormLayout;
    const auto parent = byId(displayed().value("rules").toArray(), field(rule, "parentId"));
    const auto category = byId(displayed().value("categories").toArray(), field(rule, "categoryId"));
    info->addRow("国策类别", plain(category.isEmpty() ? QString("未分类") : field(category, "name")));
    info->addRow("上级国策", plain(parent.isEmpty() ? QString("独立分支") : field(parent, "title")));
    info->addRow("触发时机", plain(field(rule, "trigger")));
    info->addRow("具体行动", plain(field(rule, "action")));
    int children = 0;
    for (const auto& child : activeRules(displayed()))
        if (child.value("parentId") == rule.value("id")) ++children;
    info->addRow("直属子国策", plain(QString("%1 项").arg(children)));
    if (!demo_) info->addRow("建立日期", plain(field(rule, "day")));
    layout->addLayout(info);
    layout->addStretch();
    enum Choice { Add = 2, Prune, Move };
    if (!demo_) {
        auto* row = new QHBoxLayout;
        auto* child = new QPushButton(available() ? "添加子国策" : "今日名额已用完");
        child->setEnabled(available());
        row->addWidget(child);
        connect(child, &QPushButton::clicked, &dialog, [&] { dialog.done(Add); });
        if (rule.value("parentId").isNull()) {
            auto* move = new QPushButton("调整分支类别");
            row->addWidget(move);
            connect(move, &QPushButton::clicked, &dialog, [&] { dialog.done(Move); });
        }
        auto* breach = new QPushButton("记录失守");
        breach->setStyleSheet("color:#923e30");
        row->addWidget(breach);
        connect(breach, &QPushButton::clicked, &dialog, [&] { dialog.done(Prune); });
        layout->addLayout(row);
    }
    auto* close = new QPushButton("关闭");
    layout->addWidget(close);
    connect(close, &QPushButton::clicked, &dialog, &QDialog::reject);
    const int result = dialog.exec();
    if (result == Add) addRule(field(rule, "id"), field(rule, "categoryId"));
    if (result == Prune) confirmPrune(rule);
    if (result == Move) moveRule(rule);
}

void TreePage::retry(const QJsonObject& rule) {
    if (demo_) demoButton_->setChecked(false);
    addRule({}, field(rule, "categoryId"), rule);
}

void TreePage::addRule(const QString& parentId, const QString& categoryId, QJsonObject retryRecord) {
    if (!available()) {
        QMessageBox::information(this, "今日名额已用完", "下一个本地自然日可以再次建立国策。");
        return;
    }
    QDialog dialog(this);
    dialog.setWindowTitle(!retryRecord.isEmpty() ? "重新尝试国策" : parentId.isEmpty() ? "新建分支" : "添加子国策");
    dialog.resize(490, 490);
    auto* layout = new QVBoxLayout(&dialog);
    if (!retryRecord.isEmpty()) {
        for (const auto& entry : state_.value("rules").toArray()) {
            const auto original = entry.toObject();
            if (field(original, "cause") != "breach" || original.value("incidentId") != retryRecord.value("incidentId")) continue;
            const auto review = original.value("review").toObject();
            if (review.isEmpty()) break;
            auto* panel = new QGroupBox(original.value("id") == retryRecord.value("id") ?
                "上次失守复盘" : QString("上级国策「%1」的失守复盘").arg(field(original, "title")));
            QStringList notes;
            if (!field(review, "reason").isEmpty()) notes << "失败原因：" + field(review, "reason");
            if (!field(review, "improvement").isEmpty()) notes << "改进计划：" + field(review, "improvement");
            auto* text = textBox(notes.join("\n"));
            text->setReadOnly(true);
            (new QVBoxLayout(panel))->addWidget(text);
            layout->addWidget(panel);
            break;
        }
    }
    auto* form = new QFormLayout;
    auto* title = new QLineEdit(field(retryRecord, "title"));
    title->setPlaceholderText("例如：无屏就寝");
    auto* trigger = textBox(field(retryRecord, "trigger"), "例如：晚上走进卧室前");
    auto* action = textBox(field(retryRecord, "action"), "例如：把手机留在客厅充电");
    auto* parent = new QComboBox;
    parent->addItem("独立分支", QString());
    for (const auto& r : activeRules(state_)) {
        parent->addItem(field(r, "title"), field(r, "id"));
        parent->setItemData(parent->count()-1, field(r, "categoryId"), Qt::UserRole+1);
    }
    const int requestedParent = parent->findData(parentId);
    if (!parentId.isEmpty() && requestedParent < 0) {
        QMessageBox::warning(this, "上级国策已有变化", "请在当前国策树中重新选择上级。");
        return;
    }
    parent->setCurrentIndex(std::max(0, requestedParent));
    auto* category = new QComboBox;
    fillCategories(category, state_, categoryId);
    const auto inheritCategory = [=] {
        const bool independent = parent->currentIndex() == 0;
        category->setEnabled(independent);
        if (!independent) category->setCurrentIndex(std::max(0, category->findData(parent->currentData(Qt::UserRole+1))));
    };
    connect(parent, QOverload<int>::of(&QComboBox::currentIndexChanged), &dialog, [=](int) { inheritCategory(); });
    inheritCategory();
    auto* badge = new QComboBox;
    const QVector<QPair<QString,QString>> badges{
        {"standard","旗帜"}, {"sun","旭日"}, {"moon","新月"}, {"book","书卷"}, {"leaf","新叶"}, {"shield","盾牌"}};
    for (const auto& entry : badges) badge->addItem(QIcon(emblemPath(entry.first)), entry.second, entry.first);
    badge->setIconSize(QSize(32, 26));
    badge->setCurrentIndex(std::max(0, badge->findData(field(retryRecord, "badge"))));
    form->addRow("国策名称", title);
    form->addRow("触发时机", trigger);
    form->addRow("具体行动", action);
    form->addRow("上级国策", parent);
    form->addRow("国策类别", category);
    form->addRow("徽章", badge);
    layout->addLayout(form);
    layout->addWidget(plain("建立后将使用今日的新增名额。"));
    auto* buttons = dialogActions(dialog, layout, "建立国策");
    connect(buttons, &QDialogButtonBox::accepted, &dialog, [&] {
        QJsonObject input{{"title", title->text()}, {"trigger", trigger->toPlainText()}, {"action", action->toPlainText()},
                          {"badge", badge->currentData().toString()}, {"parentId", link(parent->currentData().toString())},
                          {"categoryId", link(category->currentData().toString())}, {"retryOf", link(field(retryRecord, "id"))}};
        try {
            const auto next = store_.addRule(input);
            collapsedCategories_.remove(field(input, "categoryId"));
            if (filter_->currentIndex() > 0 && filter_->currentData().toString() != field(input, "categoryId"))
                filter_->setCurrentIndex(0);
            dialog.accept();
            apply(next);
        } catch (const std::exception& err) { failure(&dialog, err); }
    });
    title->setFocus();
    dialog.exec();
}

void TreePage::confirmPrune(QJsonObject rule) {
    const auto rootId = field(rule, "id");
    const auto active = activeRules(state_);
    QHash<QString, QVector<QString>> children;
    QHash<QString,QString> titles;
    for (const auto& r : active) {
        const auto id = field(r, "id");
        children[field(r, "parentId")].append(id);
        titles.insert(id, field(r, "title"));
    }
    if (!titles.contains(rootId)) {
        QMessageBox::warning(this, "国策已有变化", "这项国策已退出当前树。");
        return;
    }
    QStringList affected{rootId};
    for (int i = 0; i < affected.size(); ++i) {
        const auto descendants = children.value(affected[i]);
        for (const auto& id : descendants) affected.append(id);
    }
    threatened_ = QSet<QString>(affected.cbegin(), affected.cend());
    buildMap(false);
    QDialog dialog(this);
    dialog.setWindowTitle("记录失守与剪枝");
    dialog.resize(485, 440);
    auto* layout = new QVBoxLayout(&dialog);
    auto* header = plain(QString("「%1」失守，将撤回 %2 项国策").arg(field(rule, "title")).arg(affected.size()));
    header->setStyleSheet("font-weight:bold;color:#923e30");
    layout->addWidget(header);
    auto* form = new QFormLayout;
    auto* reason = textBox({}, "是什么让这条国策难以执行？");
    auto* improvement = textBox({}, "下次可以调整哪个动作或触发时机？");
    form->addRow("失败原因（选填）", reason);
    form->addRow("改进计划（选填）", improvement);
    layout->addLayout(form);
    layout->addWidget(plain("撤回范围"));
    auto* list = new QListWidget;
    for (const auto& id : affected)
        list->addItem((id == rootId ? QString("主动报告失守") : QString("随父节点撤回")) + "   ·   " + titles.value(id));
    layout->addWidget(list);
    layout->addWidget(plain("之后可在「历史档案」中补写或编辑复盘。"));
    auto* buttons = dialogActions(dialog, layout, "确认撤回");
    connect(buttons, &QDialogButtonBox::accepted, &dialog, [&] {
        try {
            const auto updated = store_.prune(rootId, affected, reason->toPlainText(), improvement->toPlainText());
            dialog.accept();
            apply(updated);
        } catch (const std::exception& err) { failure(&dialog, err); }
    });
    dialog.exec();
    threatened_.clear();
    buildMap(false);
}

void TreePage::moveRule(QJsonObject rule) {
    QDialog dialog(this);
    dialog.setWindowTitle("调整分支类别");
    auto* layout = new QVBoxLayout(&dialog);
    layout->addWidget(plain(QString("将「%1」及其后代一同归入选定类别。").arg(field(rule, "title"))));
    auto* category = new QComboBox;
    fillCategories(category, state_, field(rule, "categoryId"));
    layout->addWidget(category);
    auto* buttons = dialogActions(dialog, layout, "保存类别");
    connect(buttons, &QDialogButtonBox::accepted, &dialog, [&] {
        try {
            const auto updated = store_.moveBranch(field(rule, "id"), link(category->currentData().toString()));
            collapsedCategories_.remove(category->currentData().toString());
            dialog.accept();
            apply(updated);
        } catch (const std::exception& err) { failure(&dialog, err); }
    });
    dialog.exec();
}
