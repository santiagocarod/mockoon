import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import {
  UntypedFormBuilder,
  UntypedFormControl,
  UntypedFormGroup
} from '@angular/forms';
import {
  Environment,
  Environments,
  ReorderAction,
  ReorderableContainers
} from '@mockoon/commons';
import { Observable, Subject, combineLatest, merge, of } from 'rxjs';
import {
  combineLatestWith,
  distinctUntilChanged,
  distinctUntilKeyChanged,
  filter,
  map,
  takeUntil,
  tap
} from 'rxjs/operators';
import {
  CloudEnvironmentsContextMenu,
  EnvironmentsContextMenu
} from 'src/renderer/app/components/context-menu/context-menus';
import { MainAPI } from 'src/renderer/app/constants/common.constants';
import { trackById, trackByUuid } from 'src/renderer/app/libs/utils.lib';
import { ContextMenuEvent } from 'src/renderer/app/models/context-menu.model';
import { EnvironmentsStatuses } from 'src/renderer/app/models/store.model';
import { Plans } from 'src/renderer/app/models/user.model';
import { EnvironmentsService } from 'src/renderer/app/services/environments.service';
import { EventsService } from 'src/renderer/app/services/events.service';
import { SettingsService } from 'src/renderer/app/services/settings.service';
import { SyncService } from 'src/renderer/app/services/sync.service';
import { Store } from 'src/renderer/app/stores/store';
import { Config } from 'src/renderer/config';
import {
  EnvironmentsCategories,
  Settings
} from 'src/shared/models/settings.model';

@Component({
  selector: 'app-environments-menu',
  templateUrl: './environments-menu.component.html',
  styleUrls: ['./environments-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EnvironmentsMenuComponent implements OnInit, OnDestroy {
  public activeEnvironment$: Observable<Environment>;
  public environments$: Observable<Environments>;
  public cloudEnvironments$: Observable<Environments>;
  public environmentsStatus$: Observable<EnvironmentsStatuses>;
  public settings$: Observable<Settings>;
  public menuSize = Config.defaultMainMenuSize;
  public editingName = false;
  public activeEnvironmentForm: UntypedFormGroup;
  public dragEnabled = true;
  public logsRecording$ = this.eventsService.logsRecording$;
  public user$ = this.store.select('user');
  public sync$ = this.store.select('sync');
  public categories$: Observable<typeof this.categories>;
  public proPlansURL = Config.proPlansURL;
  public isCloudEnabled$: Observable<boolean>;
  public syncAlert$: Observable<string>;
  public trackByUuid = trackByUuid;
  public trackById = trackById;
  public alertLabels = {
    VERSION_TOO_OLD_WARNING:
      'We will soon not support your Mockoon version anymore. Please update.',
    OFFLINE_WARNING:
      'Concurrent offline editing may result in conflicts. In case of conflict, you will be prompted to choose between the local or remote version. Click to learn more.',
    OFFLINE_WARNING_SOLO:
      'Concurrent offline editing (multiple devices) may result in conflicts. In case of conflict, you will be prompted to choose between the local or remote version. Click to learn more.',
    OFFLINE_WARNING_GROUP:
      'Concurrent offline editing may result in conflicts. In case of conflict, you will be prompted to choose between the local or remote version. Click to learn more.'
  };
  private userAndSync$ = combineLatest([
    this.store.select('user').pipe(distinctUntilChanged()),
    this.store.select('sync').pipe(distinctUntilChanged())
  ]);
  private categories: {
    id: EnvironmentsCategories;
    label: string;
    icon$: Observable<string>;
    iconTooltip$?: Observable<string>;
    iconClasses$?: Observable<string>;
    collapsed: boolean;
  }[];
  private destroy$ = new Subject<void>();
  private offlineReasonsLabels = {
    TOO_MANY_DEVICES: 'too many devices connected',
    VERSION_TOO_OLD: 'your Mockoon version is too old, please update'
  };

  constructor(
    private formBuilder: UntypedFormBuilder,
    private environmentsService: EnvironmentsService,
    private store: Store,
    private eventsService: EventsService,
    private settingsService: SettingsService,
    private syncsService: SyncService
  ) {}

  ngOnInit() {
    this.settings$ = this.store
      .select('settings')
      .pipe(filter(Boolean), distinctUntilChanged());
    this.activeEnvironment$ = this.store.selectActiveEnvironment();
    this.environments$ = combineLatest([
      this.store.select('environments'),
      this.settings$
    ]).pipe(
      map(([environments, settings]) =>
        environments.filter((environment) =>
          settings.environments.find(
            (settingEnvironment) =>
              settingEnvironment.uuid === environment.uuid &&
              !settingEnvironment.cloud
          )
        )
      )
    );
    this.cloudEnvironments$ = combineLatest([
      this.store.select('environments').pipe(distinctUntilChanged()),
      this.settings$
    ]).pipe(
      map(([environments, settings]) =>
        environments.filter((environment) =>
          settings.environments.find(
            (settingEnvironment) =>
              settingEnvironment.uuid === environment.uuid &&
              settingEnvironment.cloud
          )
        )
      )
    );
    this.environmentsStatus$ = this.store.select('environmentsStatus');
    this.categories$ = this.settings$.pipe(
      map((settings) => {
        const sortedCategories = this.categories.sort(
          (itemA, itemB) =>
            settings.environmentsCategoriesOrder.indexOf(itemA.id) -
            settings.environmentsCategoriesOrder.indexOf(itemB.id)
        );

        return sortedCategories.map((category) => ({
          ...category,
          collapsed: settings.environmentsCategoriesCollapsed[category.id]
        }));
      })
    );
    this.syncAlert$ = combineLatest([
      this.cloudEnvironments$,
      this.userAndSync$
    ]).pipe(
      map(([cloudEnvironments, [user, sync]]) => {
        // if we have an alert from the server, display it
        if (sync.alert) {
          return sync.alert;
        }

        // if we have cloud environments and the sync is not running, display a warning to inform about offline mode
        if (cloudEnvironments.length > 0 && !sync.status) {
          return `OFFLINE_WARNING${
            user && user.plan !== 'FREE'
              ? user.plan === Plans.SOLO
                ? '_SOLO'
                : '_GROUP'
              : ''
          }`;
        }

        return null;
      })
    );
    this.isCloudEnabled$ = this.user$.pipe(
      map((user) => user && user.plan !== 'FREE')
    );

    this.categories = [
      {
        id: 'cloud',
        label: 'Cloud',
        icon$: this.userAndSync$.pipe(
          map(([user, sync]) =>
            user && user.plan !== 'FREE' && sync.status ? 'cloud' : 'cloud_off'
          )
        ),
        iconClasses$: this.userAndSync$.pipe(
          combineLatestWith(this.cloudEnvironments$),
          map(([[user, sync], cloudEnvironments]) =>
            !user || user.plan === 'FREE' || !sync.status
              ? `${
                  cloudEnvironments.length > 0 ? 'text-danger' : 'text-warning'
                } cursor-pointer`
              : 'cursor-default'
          )
        ),
        iconTooltip$: this.userAndSync$.pipe(
          map(([user, sync]) => {
            if (!sync.status) {
              if (sync.offlineReason) {
                return `Disconnected: ${
                  this.offlineReasonsLabels[sync.offlineReason]
                }. Click to try to reconnect.`;
              }

              if (!user) {
                return 'Disconnected: not logged in';
              }

              if (user.plan === 'FREE') {
                return 'Disconnected: free plan';
              }

              return 'Disconnected: please check your internet connection and your credentials. Click to try to reconnect.';
            } else {
              return 'Connected';
            }
          })
        ),
        collapsed: false
      },
      {
        id: 'local',
        label: 'Local',
        icon$: of('computer'),
        iconClasses$: of('cursor-default'),
        iconTooltip$: of(
          'Each local environment is a separate file on your computer (Right-click → Show data file in explorer/finder)'
        ),
        collapsed: false
      }
    ];
    this.initForms();
    this.initFormValues();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.unsubscribe();
  }

  public enableDrag(enable: boolean) {
    this.dragEnabled = enable;
  }

  /**
   * Callback called when reordering environments
   *
   * @param reorderAction
   */
  public reorganizeEnvironments(reorderAction: ReorderAction) {
    this.environmentsService.reorderItems(
      reorderAction as ReorderAction<string>,
      ReorderableContainers.ENVIRONMENTS
    );
  }

  /**
   * Callback called when reordering environments categories
   *
   * @param reorderAction
   */
  public reorganizeEnvironmentsCategories(reorderAction: ReorderAction) {
    this.settingsService.reorganizeEnvironmentsCategories(
      reorderAction as ReorderAction<string>
    );
  }

  /**
   * Mark a category as collapsed and update the settings
   *
   * @param categoryId
   * @param collapsed
   */
  public collapseCategory(
    categoryId: EnvironmentsCategories,
    collapsed: boolean
  ) {
    this.settingsService.updateSettings({
      environmentsCategoriesCollapsed: {
        ...this.store.get('settings').environmentsCategoriesCollapsed,
        [categoryId]: !collapsed
      }
    });
  }

  /**
   * Create a new environment. Append at the end of the list.
   */
  public addLocalEnvironment() {
    this.environmentsService.addEnvironment().subscribe();
  }

  /**
   * Open an environment. Append at the end of the list.
   */
  public openLocalEnvironment() {
    this.environmentsService.openEnvironment().subscribe();
  }

  /**
   * Create a new cloud environment. Append at the end of the cloud list.
   */
  public addCloudEnvironment() {
    this.environmentsService.addCloudEnvironment().subscribe();
  }

  /**
   * Select the active environment
   */
  public selectEnvironment(environmentUUID: string) {
    this.environmentsService.setActiveEnvironment(environmentUUID);
  }

  /**
   * Show and position the context menu
   *
   * @param event - click event
   */
  public openContextMenu(
    cloud: boolean,
    environmentUUID: string,
    event: MouseEvent
  ) {
    // if right click display context menu
    if (event && event.button === 2) {
      const menu: ContextMenuEvent = {
        event,
        items: cloud
          ? CloudEnvironmentsContextMenu(environmentUUID)
          : EnvironmentsContextMenu(
              environmentUUID,
              this.store.get('sync').status
            )
      };

      this.eventsService.contextMenuEvents.next(menu);
    }
  }

  public cloudReconnect() {
    this.syncsService.reconnect();
  }

  public openSyncAlert(syncAlert: string) {
    if (syncAlert.includes('OFFLINE_WARNING')) {
      MainAPI.send(
        'APP_OPEN_EXTERNAL_LINK',
        `${Config.docs.cloudSync}#offline-mode`
      );
    }
  }

  /**
   * Init active environment form and subscribe to changes
   */
  private initForms() {
    this.activeEnvironmentForm = this.formBuilder.group({
      name: new UntypedFormControl('')
    });

    // send new activeEnvironmentForm values to the store, one by one
    merge(
      ...Object.keys(this.activeEnvironmentForm.controls).map((controlName) =>
        this.activeEnvironmentForm.get(controlName).valueChanges.pipe(
          map((newValue) => ({
            [controlName]: newValue
          }))
        )
      )
    )
      .pipe(
        tap((newProperty) => {
          this.environmentsService.updateActiveEnvironment(newProperty, true);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  /**
   * Listen to stores to init form values
   */
  private initFormValues() {
    // subscribe to active environment changes to reset the form
    this.activeEnvironment$
      .pipe(
        filter((environment) => !!environment),
        distinctUntilKeyChanged('uuid'),
        tap((activeEnvironment) => {
          this.activeEnvironmentForm.setValue(
            {
              name: activeEnvironment.name
            },
            { emitEvent: false }
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }
}
