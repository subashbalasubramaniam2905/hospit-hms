import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RoleId } from '../models';
import { API_URL } from './api-config';

export interface Account { id: string; email: string; name: string; role: RoleId; branches: string[]; status: string; mustChangePw: boolean; }
interface LoginResponse { token: string; expiresAt: string; user: Account; }
interface Stored { token: string; expiresAt: string; user: Account; }

const KEY = 'hospitos:auth';

/**
 * Live-mode sign-in. The token is kept in sessionStorage (cleared when the browser closes) unless the user
 * asks to stay signed in on this device, which uses localStorage until the token expires.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  readonly account = signal<Account | null>(null);
  private token: string | null = null;

  constructor() {
    const s = this.read();
    if (s && new Date(s.expiresAt).getTime() > Date.now()) { this.token = s.token; this.account.set(s.user); }
    else this.clear();
  }

  get bearer() { return this.token; }

  async login(email: string, password: string, remember: boolean) {
    const r = await firstValueFrom(this.http.post<LoginResponse>(`${API_URL}/api/auth/login`, { email, password }));
    this.store(r, remember);
    return r.user;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const r = await firstValueFrom(this.http.post<LoginResponse>(`${API_URL}/api/auth/password`, { currentPassword, newPassword }));
    this.store(r, this.remembered());
    return r.user;
  }

  clear() {
    this.token = null; this.account.set(null);
    for (const s of [sessionStorage, localStorage]) { try { s.removeItem(KEY); } catch { /* ignore */ } }
  }

  private store(r: LoginResponse, remember: boolean) {
    this.clear();
    this.token = r.token; this.account.set(r.user);
    try { (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ token: r.token, expiresAt: r.expiresAt, user: r.user } satisfies Stored)); } catch { /* ignore */ }
  }
  private remembered() { try { return !!localStorage.getItem(KEY); } catch { return false; } }
  private read(): Stored | null {
    for (const s of [sessionStorage, localStorage]) { try { const v = s.getItem(KEY); if (v) return JSON.parse(v); } catch { /* ignore */ } }
    return null;
  }
}

/** The human-readable message from an API error (RFC 7807 "detail"), or a fallback. */
export function apiMessage(e: unknown, fallback = 'Something went wrong. Please try again'): string {
  const err = e as { status?: number; error?: { detail?: string } };
  if (err?.status === 0) return 'Cannot reach the HospitOS server. Check your connection';
  return err?.error?.detail || fallback;
}
