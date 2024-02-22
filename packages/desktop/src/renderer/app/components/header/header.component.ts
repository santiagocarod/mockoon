import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Environment } from '@mockoon/commons';
import { BehaviorSubject, EMPTY, Observable, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { MainAPI } from 'src/renderer/app/constants/common.constants';
import { EnvironmentLog } from 'src/renderer/app/models/environment-logs.model';
import {
  EnvironmentStatus,
  ViewsNameType
} from 'src/renderer/app/models/store.model';
import { User } from 'src/renderer/app/models/user.model';
import { EnvironmentsService } from 'src/renderer/app/services/environments.service';
import { SyncService } from 'src/renderer/app/services/sync.service';
import { UIService } from 'src/renderer/app/services/ui.service';
import { UserService } from 'src/renderer/app/services/user.service';
import { Store } from 'src/renderer/app/stores/store';
import { Config } from 'src/renderer/config';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent implements OnInit {
  public activeEnvironment$: Observable<Environment>;
  public user$: Observable<User>;
  public refreshingAccount$ = new BehaviorSubject(false);
  public activeView$: Observable<ViewsNameType>;
  public activeEnvironmentState$: Observable<EnvironmentStatus>;
  public environmentLogs$: Observable<EnvironmentLog[]>;
  public os$: Observable<string>;
  public sync$ = this.store.select('sync');
  public tabs: {
    id: ViewsNameType;
    title: string;
    icon: string;
    count$?: Observable<number>;
  }[];
  public planLabels = {
    FREE: 'Free',
    SOLO: 'Solo',
    TEAM: 'Team',
    ENTERPRISE: 'Enterprise'
  };
  public tourIds = {
    ENV_LOGS: 'tour-environment-logs',
    ENV_PROXY: 'tour-environment-proxy'
  };

  constructor(
    private store: Store,
    private environmentsService: EnvironmentsService,
    private userService: UserService,
    private uiService: UIService,
    private syncService: SyncService
  ) {}

  ngOnInit() {
    this.os$ = from(MainAPI.invoke('APP_GET_OS'));
    this.user$ = this.store.select('user');
    this.activeView$ = this.store.select('activeView');
    this.activeEnvironment$ = this.store.selectActiveEnvironment();
    this.activeEnvironmentState$ = this.store.selectActiveEnvironmentStatus();
    this.environmentLogs$ = this.store.selectActiveEnvironmentLogs();

    this.tabs = [
      {
        id: 'ENV_ROUTES',
        title: 'Routes',
        icon: 'endpoints',
        count$: this.activeEnvironment$.pipe(
          map((environment) => (environment ? environment.routes.length : null))
        )
      },
      {
        id: 'ENV_DATABUCKETS',
        title: 'Data',
        icon: 'data',
        count$: this.activeEnvironment$.pipe(
          map((environment) => (environment ? environment.data.length : null))
        )
      },
      {
        id: 'ENV_HEADERS',
        title: 'Headers',
        icon: 'featured_play_list',
        count$: this.activeEnvironment$.pipe(
          map((environment) =>
            environment ? environment.headers.length : null
          )
        )
      },
      {
        id: 'ENV_CALLBACKS',
        title: 'Callbacks',
        icon: 'call_made',
        count$: this.activeEnvironment$.pipe(
          map((environment) =>
            environment ? environment.callbacks.length : null
          )
        )
      },
      {
        id: 'ENV_LOGS',
        title: 'Logs',
        icon: 'history',
        count$: this.environmentLogs$.pipe(
          map((environmentLogs) =>
            environmentLogs ? environmentLogs.length : null
          )
        )
      },
      {
        id: 'ENV_PROXY',
        title: 'Proxy',
        icon: 'security'
      },
      { id: 'ENV_SETTINGS', title: 'Settings', icon: 'settings' }
    ];
  }

  /**
   * Set the application active view (routes / logs / settings)
   */
  public setActiveView(viewName: ViewsNameType) {
    this.environmentsService.setActiveView(viewName);
  }

  /**
   * Toggle active environment running state (start/stop)
   */
  public toggleEnvironment() {
    this.environmentsService.toggleEnvironment();
  }

  /**
   * Open the login page in the default browser
   */
  public login() {
    MainAPI.send('APP_OPEN_EXTERNAL_LINK', Config.loginURL);
    this.uiService.openModal('auth');
  }

  /**
   * Open the signup page in the default browser
   */
  public signup() {
    MainAPI.send('APP_OPEN_EXTERNAL_LINK', Config.signupURL);
  }

  /**
   * Logout the user
   */
  public logout() {
    this.userService.logout().subscribe();
  }

  /**
   * Open the account page in the default browser
   */
  public account() {
    MainAPI.send('APP_OPEN_EXTERNAL_LINK', Config.accountURL);
  }

  /**
   * Refresh the user account information
   */
  public refreshAccount() {
    this.refreshingAccount$.next(true);
    this.userService
      .getUserInfo()
      .pipe(
        catchError(() => {
          this.refreshingAccount$.next(false);

          return EMPTY;
        })
      )
      .subscribe(() => {
        this.refreshingAccount$.next(false);
      });
  }

  public disconnect() {
    this.syncService.disconnect();
  }

  public simulateTokenExp() {
    this.syncService.expireToken();
  }

  /**
   * Open the command palette
   */
  public openCommandPalette() {
    this.uiService.openModal('commandPalette');
  }
}
