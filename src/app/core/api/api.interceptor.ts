import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_URL } from './api-config';
import { AuthService } from './auth.service';
import { SessionService } from '../services/session.service';
import { KioskApi, PortalApi } from './insights-api';

/** Adds the bearer token to API calls and handles expired sessions and required password changes. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!API_URL || !req.url.startsWith(API_URL)) return next(req);
  // The patient portal and lobby kiosks carry their own tokens and never the staff one. Their screens handle sign-out themselves.
  const path = req.url.slice(API_URL.length);
  if (path.startsWith('/api/portal/') || (path.startsWith('/api/kiosk/') && !path.startsWith('/api/kiosk/devices'))) {
    const t = path.startsWith('/api/portal/') ? inject(PortalApi).token : inject(KioskApi).token;
    return next(t ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req);
  }
  const auth = inject(AuthService), router = inject(Router), session = inject(SessionService);
  const token = auth.bearer;
  const isLogin = req.url.endsWith('/api/auth/login');
  const out = token && !isLogin ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(out).pipe(catchError((e: HttpErrorResponse) => {
    if (e.status === 401 && !isLogin) { session.signOut(); router.navigate(['/login'], { queryParams: { expired: 1 } }); }
    if (e.status === 403 && e.error?.code === 'PASSWORD_CHANGE_REQUIRED') router.navigate(['/change-password']);
    return throwError(() => e);
  }));
};
