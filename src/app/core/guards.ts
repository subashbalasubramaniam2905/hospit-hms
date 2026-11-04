import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './services/session.service';
import { AuthService } from './api/auth.service';

export const authGuard: CanActivateFn = () => {
  const s = inject(SessionService), r = inject(Router), auth = inject(AuthService);
  if (s.live) {
    const a = auth.account();
    if (!a) return r.parseUrl('/login');
    if (a.mustChangePw) return r.parseUrl('/change-password');
  }
  if (!s.roleId()) return r.parseUrl('/login');
  if (s.roleId() === 'patient') return r.parseUrl('/portal');
  return true;
};

/** Role selection is a demo feature; real accounts have one role. */
export const demoOnlyGuard: CanActivateFn = () => {
  const s = inject(SessionService), r = inject(Router);
  return s.live ? r.parseUrl('/dashboard') : true;
};

export const liveOnlyGuard: CanActivateFn = () => {
  const s = inject(SessionService), r = inject(Router), auth = inject(AuthService);
  return s.live && auth.account() ? true : r.parseUrl('/login');
};
