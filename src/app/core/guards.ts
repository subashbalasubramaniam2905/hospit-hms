import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './services/session.service';

export const authGuard: CanActivateFn = () => {
  const s = inject(SessionService), r = inject(Router);
  if (!s.roleId()) return r.parseUrl('/login');
  if (s.roleId() === 'patient') return r.parseUrl('/portal');
  return true;
};
