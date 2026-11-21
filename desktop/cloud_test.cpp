#include "cloud.h"
#include "store.h"

#include <QCoreApplication>
#include <QTemporaryDir>
#include <QJsonArray>
#include <stdexcept>
#include <cstdio>

namespace {
void require(bool ok) { if (!ok) throw std::runtime_error("cloud sync assertion failed"); }
class FakeRemote : public Cloud::Remote {
public:
    Cloud::Snapshot head;
    int commits = 0;
    Cloud::Snapshot read() override { return head; }
    QString write(const QJsonObject &data, const QString &expected) override {
        if (head.revision != expected) throw std::runtime_error("CAS conflict");
        head = {QString::number(++commits), data};
        return head.revision;
    }
};
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    using namespace Cloud;
    try {
        const QJsonObject example{{"id","r1"},{"title","试验条目"},{"action","先登记"},
                                  {"review",QJsonObject{{"reason","原因 A"},{"improvement","计划 A"}}}};
        auto revised = example;
        revised["action"] = "先核对";
        revised["review"] = QJsonObject{{"reason","原因 B"},{"improvement","计划 A"}};
        const auto comparison = archiveDifferences({{"rules",QJsonArray{example}}}, {{"rules",QJsonArray{revised}}});
        require(comparison.count == 1 && comparison.highlights.first().contains("具体行动、失败原因"));
        require(comparison.details.first().contains("本机：原因 A") && comparison.details.first().contains("云端：原因 B") &&
                comparison.details.first().contains("本机：先登记") && comparison.details.first().contains("云端：先核对"));
        const QJsonObject categoryA{{"id","sample"},{"name","计划 A"}}, categoryB{{"id","sample"},{"name","计划 B"}};
        const auto changedCategories = archiveDifferences({{"categories",QJsonArray{categoryA}},{"rules",QJsonArray{example}}},
                                                          {{"categories",QJsonArray{categoryB}}});
        require(changedCategories.count == 2 && changedCategories.highlights.last().contains("仅本机有"));
        require(changedCategories.details.first().contains("云端：计划 B"));
        QTemporaryDir a, b;
        require(a.isValid() && b.isValid());
        Store desktop(a.filePath("archive.json")), phone(b.filePath("archive.json"));
        FakeRemote server;
        desktop.addCategory("同步测试");
        const auto first = inspect(desktop, server, {});
        require(first.direction == Direction::Choose);
        auto desktopBase = apply(desktop, server, first, Direction::Upload);
        auto initialPhone = inspect(phone, server, {});
        require(initialPhone.direction == Direction::Choose);
        auto phoneBase = apply(phone, server, initialPhone, Direction::Download);
        require(desktop.load() == phone.load());
        auto identical = inspect(desktop, server, desktopBase);
        require(identical.direction == Direction::Equal && apply(desktop, server, identical, identical.direction).revision == server.head.revision);
        phone.addCategory("设备二");
        auto push = inspect(phone, server, phoneBase);
        require(push.direction == Direction::Upload);
        phoneBase = apply(phone, server, push, push.direction);
        auto pull = inspect(desktop, server, desktopBase);
        require(pull.direction == Direction::Download);
        desktopBase = apply(desktop, server, pull, pull.direction);
        require(desktop.load() == phone.load());
        phone.addCategory("离线更改甲");
        desktop.addCategory("离线更改乙");
        auto changed = inspect(phone, server, phoneBase);
        apply(phone, server, changed, changed.direction);
        auto conflict = inspect(desktop, server, desktopBase);
        require(conflict.direction == Direction::Choose);
        auto saved = desktop.load();
        server.write(phone.load(), server.head.revision);
        for (auto direction : {Direction::Upload, Direction::Download}) {
            bool rejected = false;
            try { apply(desktop, server, conflict, direction); } catch (const std::exception &) { rejected = true; }
            require(rejected && desktop.load() == saved);
        }
        server.head = {};
        require(inspect(desktop, server, desktopBase).direction == Direction::Choose);
        puts("Passed native cloud two-device, first setup, no-op, conditional update and divergence tests.");
    } catch (const std::exception &e) { fprintf(stderr, "%s\n", e.what()); return 1; }
}
