import { FONT_MONO } from '../constants'

export default function TransferRow({ transfer, index, completed = false, onCancel }) {
  return (
    <div key={`${transfer.username}-${transfer.filename}-${index}`} className="flex items-center gap-2">
      <span className={`shrink-0 ${completed ? 'text-[#7FD8CC]' : 'text-[#8D93A6]'}`} style={{ fontFamily: FONT_MONO }}>
        {completed ? 'finalizado' : transfer.state} · {Math.round(transfer.percentComplete || 0)}%
      </span>
      <span className="truncate text-[#E9EAF0]" title={transfer.filename}>@{transfer.username}</span>
      {!completed && (
        <button
          type="button"
          onClick={() => onCancel(transfer.username, transfer.filename)}
          className="ml-auto shrink-0 rounded border border-[#FFFFFF]/40 px-1.5 py-0.5 text-[10px] text-[#FFFFFF] hover:bg-[#FFFFFF]/10"
        >
          cancelar
        </button>
      )}
    </div>
  )
}
