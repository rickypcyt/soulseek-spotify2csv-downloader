import { ChevronDown } from 'lucide-react'
import TransferRow from './TransferRow'
import { FONT_MONO } from '../constants'

export default function TransfersPanel({
  diagnostics,
  activeTransfers,
  completedTransfers,
  completedTransfersOpen,
  onToggleCompletedTransfers,
  onCancelTransfer,
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col rounded-lg border border-[#2C303D]">
      <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
        <h2 className="text-xs text-[#8D93A6]">descargas en curso y en cola</h2>
        <span className="rounded-full border border-[#3A3F4E] px-2 py-0.5 text-[10px] text-[#E9EAF0]" style={{ fontFamily: FONT_MONO }}>
          {activeTransfers.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#0D0F16] p-3 text-[11px] text-[#E9EAF0]">
        {!diagnostics ? (
          <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>cargando…</p>
        ) : (
          <div className="space-y-3">
            {activeTransfers.length > 0 && (
              <div>
                <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>slskd · activos</p>
                <div className="space-y-1">
                  {activeTransfers.map((transfer, index) => (
                    <TransferRow key={`${transfer.username}-${transfer.filename}-${index}`} transfer={transfer} index={index} onCancel={onCancelTransfer} />
                  ))}
                </div>
              </div>
            )}
            {completedTransfers.length > 0 && (
              <details
                open={completedTransfersOpen}
                onToggle={(event) => onToggleCompletedTransfers(event.currentTarget.open)}
                className="group rounded border border-[#2C303D] bg-[#161822]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[#8D93A6] [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2" style={{ fontFamily: FONT_MONO }}>
                    <span>slskd · finalizados</span>
                    <span className="rounded-full border border-[#3A3F4E] px-1.5 py-0.5 text-[10px] text-[#E9EAF0]">{completedTransfers.length}</span>
                  </span>
                  <ChevronDown size={13} className="transition-transform duration-150 group-open:rotate-180" />
                </summary>
                {completedTransfersOpen && (
                  <div className="space-y-1 border-t border-[#2C303D] px-2 py-1.5">
                    {completedTransfers.map((transfer, index) => (
                      <TransferRow key={`${transfer.username}-${transfer.filename}-${index}`} transfer={transfer} index={index} completed onCancel={onCancelTransfer} />
                    ))}
                  </div>
                )}
              </details>
            )}
            {activeTransfers.length === 0 && completedTransfers.length === 0 && (
              <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>sin descargas en curso</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
