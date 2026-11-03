import { Pipe, PipeTransform } from '@angular/core';

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const inr = (n: number | null | undefined) => '₹' + inrFmt.format(Math.round(n ?? 0));
export const inrShort = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K` : inr(n);
export const initials = (n: string) => n.replace(/^Dr\.\s*/, '').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
export const ageOf = (dob: string) => { const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return Math.max(0, a); };
export const fmtDate = (iso: string, withYear = false) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00' : iso.replace(' ', 'T'));
  return d.toLocaleDateString('en-IN', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
};

@Pipe({ name: 'inr' }) export class InrPipe implements PipeTransform { transform(v: number | null | undefined, short = false) { return short ? inrShort(v ?? 0) : inr(v); } }
@Pipe({ name: 'initials' }) export class InitialsPipe implements PipeTransform { transform(v: string | undefined) { return initials(v || '?'); } }
@Pipe({ name: 'age' }) export class AgePipe implements PipeTransform { transform(v: string | undefined) { return v ? ageOf(v) : ''; } }
@Pipe({ name: 'd' }) export class DatePipeLite implements PipeTransform { transform(v: string | undefined, y = false) { return fmtDate(v || '', y); } }
@Pipe({ name: 'time12' }) export class Time12Pipe implements PipeTransform {
  transform(v: string | undefined) { if (!v) return ''; const [h, m] = v.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; }
}
