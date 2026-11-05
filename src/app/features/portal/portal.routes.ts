import { Routes } from '@angular/router';
import { LIVE } from '../../core/api/api-config';
export const PORTAL_ROUTES: Routes = [
  { path: '', loadComponent: () => LIVE ? import('./portal-live').then(m => m.PortalLivePage) : import('./portal').then(m => m.PortalPage), title: 'Patient portal · HospitOS' },
];
