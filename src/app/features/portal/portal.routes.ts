import { Routes } from '@angular/router';
export const PORTAL_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./portal').then(m => m.PortalPage), title: 'Patient portal · HospitOS' },
];
