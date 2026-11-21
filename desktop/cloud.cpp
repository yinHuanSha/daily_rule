#include "cloud.h"
#include "store.h"

#include <QCryptographicHash>
#include <QJsonDocument>
#include <stdexcept>

namespace Cloud {
QString fingerprint(const QJsonObject &archive) {
    const auto bytes = QJsonDocument(archive).toJson(QJsonDocument::Compact);
    return QString::fromLatin1(QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex());
}

Preview inspect(Store &store, Remote &provider, const Baseline &base) {
    Preview preview;
    preview.remote = provider.read();
    preview.local = store.load();
    if (!preview.remote.revision.isEmpty() && preview.local == preview.remote.state)
        preview.direction = Direction::Equal;
    else if (!base.hash.isEmpty() && !base.revision.isEmpty() && !preview.remote.revision.isEmpty()) {
        if (preview.remote.revision == base.revision || fingerprint(preview.remote.state) == base.hash)
            preview.direction = Direction::Upload;
        else if (fingerprint(preview.local) == base.hash)
            preview.direction = Direction::Download;
    }
    return preview;
}

Baseline apply(Store &store, Remote &provider, const Preview &preview, Direction direction) {
    if (store.load() != preview.local)
        throw std::runtime_error("本机档案在预览后已有修改，请重新同步。");
    if (direction == Direction::Upload)
        return {fingerprint(preview.local), provider.write(preview.local, preview.remote.revision)};
    if (direction == Direction::Download) {
        const auto current = provider.read();
        if (current.revision.isEmpty() || current.revision != preview.remote.revision || current.state != preview.remote.state)
            throw std::runtime_error("云端档案在预览后已有修改，请重新同步。");
        store.importBackup(QJsonDocument(current.state).toJson(), preview.local);
        return {fingerprint(current.state), current.revision};
    }
    if (direction == Direction::Equal && preview.direction == Direction::Equal)
        return {fingerprint(preview.local), preview.remote.revision};
    throw std::runtime_error("请选择本次同步方向。");
}
}
