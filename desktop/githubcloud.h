#pragma once

#include "cloud.h"
#include <QNetworkAccessManager>

namespace Cloud {
QString normalizeRepository(const QString &input);
class GitHubRemote final : public Remote {
public:
    GitHubRemote(const QString &repository, QByteArray token);
    Snapshot read() override;
    QString write(const QJsonObject &state, const QString &expectedRevision) override;
private:
    QJsonObject request(const QString &method, const QUrl &endpoint, const QJsonObject &body = {}, bool allowMissing = false);
    QString checkPrivate();
    QString path;
    QByteArray credential;
    QString branch;
    QString repositoryId;
    QNetworkAccessManager network;
};
}
