export function registerOffline(): void {
  if ('DailyRuleAndroid' in window || !import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return

  const base = new URL(import.meta.env.BASE_URL, document.baseURI)
  // A relative URL keeps the worker and its scope inside the deployment directory.
  void navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.href }).catch((error: unknown) => {
    console.warn('国策树离线缓存注册失败。', error)
  })
}
