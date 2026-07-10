function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function runtimeTemplateVariables() {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return {
    date,
    time,
    datetime: `${date} ${time}`,
    timestamp: String(now.getTime()),
  }
}

function dateToken(pattern: string, now = new Date()): string {
  const fullYear = String(now.getFullYear())
  const shortYear = fullYear.slice(-2)
  const month = pad2(now.getMonth() + 1)
  const day = pad2(now.getDate())
  const hour = pad2(now.getHours())
  const minute = pad2(now.getMinutes())
  const second = pad2(now.getSeconds())
  return pattern
    .replace(/yyyy/g, fullYear)
    .replace(/yy/g, shortYear)
    .replace(/MM/g, month)
    .replace(/dd/g, day)
    .replace(/HH/g, hour)
    .replace(/mm/g, minute)
    .replace(/ss/g, second)
}

export function renderRuntimeTemplate(template: string, text = ""): string {
  const values = runtimeTemplateVariables()
  return template
    .replace(/\{\{CURSOR\}\}/g, "")
    .replace(/\{\{CLIPBOARD\}\}/g, text)
    .replace(/\{\{DATE:([^}]+)\}\}/g, (_match, pattern) => dateToken(String(pattern || "yyyy-MM-dd")))
    .replace(/\{\{text\}\}/g, text)
    .replace(/\{\{date\}\}/g, values.date)
    .replace(/\{\{time\}\}/g, values.time)
    .replace(/\{\{datetime\}\}/g, values.datetime)
    .replace(/\{\{timestamp\}\}/g, values.timestamp)
}
