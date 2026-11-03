import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SHARED } from '../shared';
@Component({
  standalone: true, imports: [SHARED],
  template: `
  <div class="page">
    <div class="card" style="max-width:560px;margin:40px auto">
      <cf-empty icon="map-pin" title="Page not found" [text]="'There is no screen at ' + url + '. It may have moved, or your role may not include it.'">
        <div class="row" style="justify-content:center;margin-top:8px"><button class="btn ghost" (click)="back()">Go back</button><a class="btn" routerLink="/dashboard">Open dashboard</a></div>
      </cf-empty>
    </div>
  </div>`
})
export class NotFoundPage { router = inject(Router); url = this.router.url; back() { history.length > 1 ? history.back() : this.router.navigate(['/dashboard']); } }
