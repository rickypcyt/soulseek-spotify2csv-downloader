import { forwardRef } from 'react'
import { StatusDot } from './ui'
import { FONT_MONO } from '../constants'

const LogsPanel = forwardRef(function LogsPanel({ logs, backendOnline }, ref) {
  return (
    <div className="flex min-h-[calc(100vh-15rem)] h-[calc(100vh-15rem)] flex-col rounded-lg border border-[#2C303D]">
      <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
        <h2 className="text-xs text-[#8D93A6]">logs</h2>
        <StatusDot ok={backendOnline} />
      </div>
      <pre
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap bg-[#0D0F16] p-3 text-[11px] leading-relaxed text-[#7FD8CC]"
        style={{ fontFamily: FONT_MONO }}
      >
        {logs.join('\n')}
      </pre>
    </div>
  )
})

export default LogsPanel
