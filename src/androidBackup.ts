type ExportResult = { ticket: string; status: 'saved' | 'cancel' | 'busy' | 'error' }

export function androidBackup() {
  return (window as Window & {
    DailyRuleAndroid?: { exportJson(filename: string, json: string, ticket: string): void }
  }).DailyRuleAndroid
}

export function saveAndroidBackup(filename: string, json: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ticket = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-')
    function finished(event: Event) {
      const detail = (event as CustomEvent<ExportResult>).detail
      if (detail.ticket !== ticket) return
      window.removeEventListener('daily-rule-export', finished)
      if (detail.status === 'saved' || detail.status === 'cancel') resolve(detail.status === 'saved')
      else reject(new Error(detail.status === 'busy' ? '请先完成上一次文件保存。' : '备份未保存，请重试。'))
    }
    const native = androidBackup()
    if (!native) { reject(new Error('系统文件导出不可用。')); return }
    window.addEventListener('daily-rule-export', finished)
    try { native.exportJson(filename, json, ticket) }
    catch (error) {
      window.removeEventListener('daily-rule-export', finished)
      reject(error)
    }
  })
}
