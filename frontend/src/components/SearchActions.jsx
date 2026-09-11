export default function SearchActions({ searchId, onRefresh, onCancel }) {
  return (
    <div className="mt-2 flex gap-1.5">
      <button
        type="button"
        onClick={() => onRefresh(searchId)}
        className="rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
      >
        refrescar
      </button>
      <button
        type="button"
        onClick={() => onCancel(searchId)}
        className="rounded border border-[#6B7280]/40 px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#6B7280] hover:text-[#E9EAF0]"
      >
        cancelar
      </button>
    </div>
  )
}
