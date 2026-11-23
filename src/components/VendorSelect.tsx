import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { filterVendors } from '../utils/vendorSearch';

type VendorOption = { id: string; name: string; status?: string };

type Props = {
  vendors: readonly VendorOption[];
  currentVendor?: VendorOption | null;
  value: string;
  onChange: (id: string) => void;
  label: string;
  id?: string;
  emptyLabel: string;
  externalLabel?: string;
  showStatus?: boolean;
  className?: string;
};

export default function VendorSelect({
  vendors, currentVendor, value, onChange, label, id, emptyLabel, externalLabel, showStatus, className,
}: Props) {
  const [query, setQuery] = useState('');
  const feedbackId = useId();
  const matches = filterVendors(vendors, query);
  const selected = vendors.find((vendor) => vendor.id === value) ??
    (currentVendor?.id === value ? currentVendor : null);
  const showSelected = Boolean(value && !(value === 'EXTERNAL' && externalLabel) &&
    !matches.some((vendor) => vendor.id === value));
  const noMatches = query.trim() !== '' && matches.length === 0;
  const optionLabel = ({ name, status }: VendorOption) => showStatus && status ? `${name} (${status})` : name;

  return (
    <div className={`min-w-0 space-y-1.5 ${className ?? ''}`}>
      <div className="relative">
        <Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          aria-label="ค้นหาชื่อบริษัท"
          aria-describedby={noMatches ? feedbackId : undefined}
          autoComplete="off"
          placeholder="ค้นหาชื่อบริษัท"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
          }}
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
      </div>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery('');
        }}
        className="min-h-11 w-full truncate rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      >
        <option value="">{emptyLabel}</option>
        {showSelected && <option value={value}>{selected ? optionLabel(selected) : 'บริษัทที่เลือกไว้'}</option>}
        {matches.map((vendor) => <option key={vendor.id} value={vendor.id}>{optionLabel(vendor)}</option>)}
        {externalLabel && <option value="EXTERNAL">{externalLabel}</option>}
      </select>
      {noMatches && <p id={feedbackId} role="status" className="px-1 text-xs font-semibold text-slate-600">ไม่พบบริษัทที่ตรงกับคำค้น</p>}
    </div>
  );
}
