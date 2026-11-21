#include "githubcloud.h"
#include "store.h"

#include <QEventLoop>
#include <QCryptographicHash>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QSslSocket>
#include <QTimer>
#include <QUrlQuery>
#include <stdexcept>

namespace Cloud {
namespace {
constexpr qint64 maxArchiveBytes = 16LL * 1024 * 1024;
[[noreturn]] void fail(const QString &message) { throw std::runtime_error(message.toStdString()); }
bool validSha(const QString &sha) {
    static const QRegularExpression format(QStringLiteral("^(?:[a-f0-9]{40}|[a-f0-9]{64})$"));
    return format.match(sha).hasMatch();
}
}
QString normalizeRepository(const QString &input) {
    const auto name = input.trimmed().toLower();
    static const QRegularExpression pattern(QStringLiteral("^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9_.-]{1,100}$"));
    const auto repo = name.section('/', 1);
    if (!pattern.match(name).hasMatch() || repo == "." || repo == "..")
        fail("请输入「账号名/私有仓库名」，例如 yinHuanSha/daily_rule_sync。");
    if (name == "yinhuansha/daily_rule") fail("请使用专门保存个人档案的私有仓库。");
    return name;
}

GitHubRemote::GitHubRemote(const QString &repository, QByteArray token)
    : path("https://api.github.com/repos/" + normalizeRepository(repository)), credential(std::move(token)) {
    if (credential.trimmed().isEmpty()) fail("请先填写 GitHub 访问令牌。");
}

QJsonObject GitHubRemote::request(const QString &method, const QUrl &url, const QJsonObject &body, bool allowMissing) {
    if (!QSslSocket::supportsSsl()) fail("当前程序缺少 HTTPS 组件，请使用完整的桌面版文件夹。");
    QNetworkRequest request(url);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setRawHeader("User-Agent", "daily-rule-desktop");
    request.setRawHeader("Accept", "application/vnd.github+json");
    request.setRawHeader("Authorization", "Bearer " + credential);
    request.setRawHeader("X-GitHub-Api-Version", "2022-11-28");
    QNetworkReply *reply = nullptr;
    if (method == "GET") reply = network.get(request);
    else {
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        reply = network.put(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    }
    QEventLoop loop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QObject::connect(&timeout, &QTimer::timeout, reply, &QNetworkReply::abort);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    timeout.start(45000);
    if (!reply->isFinished()) loop.exec();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const auto error = reply->error();
    const auto bytes = reply->isOpen() ? reply->readAll() : QByteArray{};
    reply->deleteLater();
    if (status == 404 && allowMissing) return {};
    if (status == 404 || status == 401 || status == 403)
        fail(QString("GitHub 未允许访问（%1）。请核对私有仓库和令牌的 Contents 读写权限。").arg(status));
    if (status == 409 || status == 422 || status == 412)
        fail("云端版本已变化或当前分支禁止写入，请重新同步并核对仓库权限。");
    if (status >= 300 && status < 400) fail("远端仓库地址已变更，请核对仓库名称后重试。");
    if (status == 0 || error == QNetworkReply::OperationCanceledError)
        fail("暂时无法连接 GitHub，请检查网络后重试。本机仍可离线使用。");
    if (status < 200 || status >= 300 || error != QNetworkReply::NoError)
        fail(QString("GitHub 请求未完成（HTTP %1），请稍后再试。").arg(status));
    QJsonParseError jsonError;
    const auto doc = QJsonDocument::fromJson(bytes, &jsonError);
    if (jsonError.error != QJsonParseError::NoError || !doc.isObject()) fail("GitHub 返回了无效的同步响应。");
    return doc.object();
}

QString GitHubRemote::checkPrivate() {
    const auto meta = request("GET", QUrl(path));
    if (!meta.value("private").toBool(false)) fail("此仓库未设为私有。请改用专用私有仓库再同步。");
    const auto fullName = meta.value("full_name").toString().toLower();
    if (path != "https://api.github.com/repos/" + fullName) fail("同步仓库名称未通过核对。");
    const auto name = meta.value("default_branch").toString();
    const auto id = meta.value("node_id").toString();
    if (name.isEmpty() || id.isEmpty()) fail("未取得仓库默认分支。");
    if ((!branch.isEmpty() && name != branch) || (!repositoryId.isEmpty() && id != repositoryId))
        fail("远端仓库或默认分支已变更，请重新同步。");
    branch = name;
    repositoryId = id;
    return branch;
}

Snapshot GitHubRemote::read() {
    QUrl url(path + "/contents/archive.json");
    QUrlQuery query;
    query.addQueryItem("ref", checkPrivate());
    url.setQuery(query);
    auto object = request("GET", url, {}, true);
    if (object.isEmpty()) return {};
    const QString sha = object.value("sha").toString();
    if (object.value("size").toDouble(-1) > maxArchiveBytes) fail("云端档案已超过设备同步上限 16 MiB。");
    if (object.value("type") != "file" || !validSha(sha)) fail("云端 archive.json 不是有效的档案文件。");
    if (object.value("encoding").toString() != "base64") {
        object = request("GET", QUrl(path + "/git/blobs/" + sha));
        if (object.value("sha").toString() != sha) fail("云端文件读取不完整。");
    }
    if (object.value("encoding").toString() != "base64") fail("云端档案编码有误。");
    const auto bytes = QByteArray::fromBase64(object.value("content").toString().toLatin1());
    if (bytes.size() > maxArchiveBytes) fail("云端档案已超过设备同步上限 16 MiB。");
    const auto hashType = sha.size() == 64 ? QCryptographicHash::Sha256 : QCryptographicHash::Sha1;
    const auto actual = QCryptographicHash::hash("blob " + QByteArray::number(bytes.size()) + '\0' + bytes, hashType);
    if (actual.toHex() != sha.toLatin1()) fail("云端档案内容不完整，请重新同步。");
    return {sha, Store::decode(bytes)};
}

QString GitHubRemote::write(const QJsonObject &state, const QString &expectedRevision) {
    const auto bytes = QJsonDocument(state).toJson(QJsonDocument::Compact);
    if (bytes.size() > maxArchiveBytes) fail("本机档案已超过设备同步上限 16 MiB。");
    QJsonObject change{{"message", "同步每日国策档案"}, {"branch", checkPrivate()},
        {"content", QString::fromLatin1(bytes.toBase64())}};
    if (!expectedRevision.isEmpty()) change["sha"] = expectedRevision;
    const auto commit = request("PUT", QUrl(path + "/contents/archive.json"), change);
    const auto revision = commit.value("content").toObject().value("sha").toString();
    if (!validSha(revision)) fail("尚未取得新版本号，请重新同步以核对结果。");
    return revision;
}
}
