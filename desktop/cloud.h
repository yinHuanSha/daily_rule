#pragma once

#include <QJsonObject>
#include <QString>
#include <QStringList>

class Store;

namespace Cloud {
struct Snapshot {
    QString revision; // Empty only when the remote archive does not exist.
    QJsonObject state;
};

class Remote {
public:
    virtual ~Remote() = default;
    virtual Snapshot read() = 0;
    virtual QString write(const QJsonObject &state, const QString &expectedRevision) = 0;
};

enum class Direction { Equal, Upload, Download, Choose };
struct Preview {
    Direction direction = Direction::Choose;
    QJsonObject local;
    Snapshot remote;
};
struct Baseline {
    QString hash;
    QString revision;
};

struct Differences {
    QStringList highlights;
    QStringList details;
    int count = 0;
};
Differences archiveDifferences(const QJsonObject &local, const QJsonObject &cloud);
QString fingerprint(const QJsonObject &archive);
Preview inspect(Store &store, Remote &remote, const Baseline &base);
Baseline apply(Store &store, Remote &remote, const Preview &preview, Direction direction);
}
