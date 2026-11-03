import { DecimalPipe, NgClass, NgTemplateOutlet, PercentPipe, TitleCasePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AgePipe, DatePipeLite, InitialsPipe, InrPipe, Time12Pipe } from './pipes';
import { AvatarComponent, CellDirective, ChartComponent, DrawerComponent, EmptyComponent, ErrorStateComponent, ModalComponent, PageHeadComponent, SkeletonComponent, StatComponent, StatusComponent, TableComponent, VoiceComponent } from './ui';

export * from './pipes';
export * from './ui';

/** Imports shared by every feature screen. */
export const SHARED = [
  NgClass, NgTemplateOutlet, DecimalPipe, PercentPipe, TitleCasePipe, FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, LucideAngularModule,
  MatMenuModule, MatTooltipModule, MatSlideToggleModule, MatCheckboxModule, MatProgressBarModule,
  InrPipe, InitialsPipe, AgePipe, DatePipeLite, Time12Pipe,
  StatusComponent, AvatarComponent, PageHeadComponent, StatComponent, EmptyComponent, SkeletonComponent, ErrorStateComponent, DrawerComponent, ModalComponent, ChartComponent, TableComponent, CellDirective, VoiceComponent,
] as const;
