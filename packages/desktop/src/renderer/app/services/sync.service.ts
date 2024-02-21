import { Injectable } from '@angular/core';
import {
  BaseSyncAction,
  DownSyncActions,
  EnvironmentsListPayload,
  ServerAcknowledgment,
  SyncActions,
  SyncErrors,
  SyncMessageTypes,
  SyncPresence,
  UpdatesSyncActions,
  buildSyncActionKey,
  transformSyncAction,
  updatesSyncActionsList
} from '@mockoon/cloud';
import { RandomInt, generateUUID } from '@mockoon/commons';
import {
  EMPTY,
  Observable,
  combineLatest,
  concat,
  debounceTime,
  delay,
  distinctUntilChanged,
  filter,
  fromEvent,
  groupBy,
  map,
  merge,
  mergeMap,
  of,
  scan,
  switchMap,
  tap
} from 'rxjs';
import { Socket, io } from 'socket.io-client';
import { Plans } from 'src/renderer/app/models/user.model';
import { EnvironmentsService } from 'src/renderer/app/services/environments.service';
import { RemoteConfigService } from 'src/renderer/app/services/remote-config.service';
import { SyncPayloadsService } from 'src/renderer/app/services/sync-payloads.service';
import { UIService } from 'src/renderer/app/services/ui.service';
import { UserService } from 'src/renderer/app/services/user.service';
import {
  updateSettingsEnvironmentDescriptorAction,
  updateSyncAction
} from 'src/renderer/app/stores/actions';
import { Store } from 'src/renderer/app/stores/store';
import { Config } from 'src/renderer/config';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private deviceId: string;
  private socket: Socket;
  private timeDifference: number;

  constructor(
    private userService: UserService,
    private store: Store,
    private syncPayloadsService: SyncPayloadsService,
    private environmentsService: EnvironmentsService,
    private remoteConfig: RemoteConfigService,
    private uiService: UIService
  ) {}

  /**
   * Initialize the socket connection.
   * Get a token from the server, then connect to the socket server and listen to events.
   *
   * @returns
   */
  public init() {
    this.setDeviceId();

    return this.remoteConfig.get('cloudSyncUrl').pipe(
      filter((cloudSyncUrl) => !!cloudSyncUrl),
      tap((cloudSyncUrl) => {
        if (!this.socket) {
          console.log('init socket');

          this.socket = io(cloudSyncUrl, {
            transports: ['websocket'],
            query: { deviceId: this.deviceId, version: Config.appVersion },
            auth: { token: null },
            autoConnect: false,
            reconnectionDelay: 5000
          });
        }
      }),
      mergeMap(() =>
        merge(
          this.initListeners(),
          combineLatest([
            this.store.select('user'),
            this.userService.idTokenChanges().pipe(distinctUntilChanged())
          ]).pipe(
            // wait a bit before reacting to user changes, to avoid emitting sync status changes too soon and hit a race condition
            delay(500),
            tap(([user, token]) => {
              if (user && user.plan !== Plans.FREE && token) {
                console.log('connect socket');

                this.socket.auth = { ...this.socket.auth, token };
                this.socket.connect();

                return;
              }

              console.log('no user or token');

              console.log('disconnect socket');
              this.socket.disconnect();
            })
          )
        )
      )
    );
  }

  public disconnect() {
    this.socket.disconnect();
  }

  // TBR
  public expireToken() {
    this.socket.auth = {
      ...this.socket.auth,
      token: 'expired'
    };
  }

  public reconnect() {
    this.socket.connect();
  }

  private initListeners() {
    return merge(
      this.onConnect(this.socket),
      this.onConnectError(this.socket),
      this.onDisconnect(this.socket),
      this.onMessage(this.socket)
    );
  }

  private onConnect(socket: Socket) {
    return fromEvent(socket, 'connect').pipe(
      tap(() => {
        this.store.update(updateSyncAction({ status: true }));

        this.calculateTimeDifference();

        this.requestEnvironmentList();

        console.log('connected listener');
      }),
      switchMap(() => this.propagateStoreActions())
    );
  }

  private onConnectError(socket: Socket) {
    return fromEvent(socket, 'connect_error').pipe(
      switchMap((error) => {
        console.log('connect_error listener', error);

        if (error.message === SyncErrors.UNAUTHORIZED) {
          return this.userService.getIdToken().pipe(
            tap((token) => {
              console.log('new token', token);
              socket.auth = { ...socket.auth, token };
              // Unauthorized response will close the connection
              socket.connect();
            })
          );
        } else if (error.message === SyncErrors.TOO_MANY_DEVICES) {
          this.store.update(
            updateSyncAction({ offlineReason: SyncErrors.TOO_MANY_DEVICES })
          );
        } else if (error.message === SyncErrors.VERSION_TOO_OLD) {
          this.store.update(
            updateSyncAction({ offlineReason: SyncErrors.VERSION_TOO_OLD })
          );
        }

        return EMPTY;
      })
    );
  }

  private onDisconnect(socket: Socket) {
    return fromEvent(socket, 'disconnect').pipe(
      tap((r) => {
        this.store.update(
          updateSyncAction({ status: false, presence: null, alert: null })
        );
        console.log('disconnected listener', r);
      })
    );
  }

  private onMessage(socket: Socket) {
    return merge(
      this.onReceiveEnvironmentsList(socket),
      this.onReceiveSyncAction(socket),
      this.onPresenceUpdate(socket),
      this.onAlert(socket)
    );
  }

  /**
   * Listen to env list messages and compare the local and remote hashes to decide if we need to pull or push the environment.
   * We do nothing if there are actions in the send buffer.
   *
   * @param socket
   * @returns
   */
  private onReceiveEnvironmentsList(socket: Socket) {
    return fromEvent<EnvironmentsListPayload>(
      socket,
      SyncMessageTypes.ENV_LIST
    ).pipe(
      switchMap((updatedCloudEnvironmentsList) => {
        const environmentDescriptors = this.store.get('settings').environments;

        const hashes$: Observable<{
          environmentUuid: string;
          serverHash: string;
          lastServerHash: string | null;
          hash: string | null;
        }>[] = [];

        this.environmentsService.convertAllToLocal(
          updatedCloudEnvironmentsList
        );

        updatedCloudEnvironmentsList.forEach((updatedCloudEnvironment) => {
          const existingEnvironmentDescriptor = environmentDescriptors.find(
            (environmentDescriptor) =>
              environmentDescriptor.uuid ===
              updatedCloudEnvironment.environmentUuid
          );

          // if it's an existing environment, get its hash
          if (existingEnvironmentDescriptor) {
            // if cloud is at false it's an error, update
            if (!existingEnvironmentDescriptor.cloud) {
              this.store.update(
                updateSettingsEnvironmentDescriptorAction({
                  uuid: updatedCloudEnvironment.environmentUuid,
                  cloud: true
                })
              );
            }

            hashes$.push(
              this.syncPayloadsService
                .computeHash(
                  this.store.getEnvironmentByUUID(
                    updatedCloudEnvironment.environmentUuid
                  )
                )
                .pipe(
                  map((hash) => ({
                    environmentUuid: updatedCloudEnvironment.environmentUuid,
                    serverHash: updatedCloudEnvironment.hash,
                    lastServerHash:
                      existingEnvironmentDescriptor.lastServerHash,
                    hash
                  }))
                )
            );
          } else {
            hashes$.push(
              of({
                environmentUuid: updatedCloudEnvironment.environmentUuid,
                serverHash: updatedCloudEnvironment.hash,
                lastServerHash: null,
                hash: null
              })
            );
          }
        });

        return concat(...hashes$);
      }),
      // delay each hash check to avoid hitting the server too hard
      delay(100),
      switchMap((hashResult) => {
        let observable$ = of(true);

        console.log(JSON.stringify(hashResult, null, 2));

        // if local hash is null or different, push or pull the environment
        if (
          hashResult.hash === null ||
          hashResult.hash !== hashResult.serverHash
        ) {
          // server version changed, pull
          if (hashResult.lastServerHash !== hashResult.serverHash) {
            observable$ = this.uiService
              .showConfirmDialog({
                title: 'Conflict detected',
                text: `The environment "${
                  this.store.getEnvironmentByUUID(hashResult.environmentUuid)
                    .name
                }" was modified on the server while you were disconnected. Do you want to keep your local version or accept the remote one?`,
                sub: 'Both actions are destructive and will overwrite the other version.',
                subIcon: 'warning',
                subIconClass: 'text-warning',
                confirmButtonText: 'Accept remote and pull',
                cancelButtonText: 'Keep local and push'
              })
              .pipe(
                tap((result) => {
                  if (result) {
                    // accept remote and pull
                    this.sendGetFullEnvironment(hashResult.environmentUuid);
                  } else {
                    // keep local and push
                    this.sendUpdateFullEnvironment(hashResult.environmentUuid);
                  }
                })
              );
          } else if (hashResult.lastServerHash === hashResult.serverHash) {
            // local version changed, but server's stayed the same, push
            observable$ = observable$.pipe(
              tap(() => {
                this.sendUpdateFullEnvironment(hashResult.environmentUuid);
              })
            );
          }
        }

        return observable$.pipe(
          tap(() => {
            if (hashResult.lastServerHash !== hashResult.serverHash) {
              this.store.update(
                updateSettingsEnvironmentDescriptorAction({
                  uuid: hashResult.environmentUuid,
                  lastServerHash: hashResult.serverHash
                })
              );
            }
          })
        );
      })
    );
  }

  /**
   * Listen to sync actions and verify if they can be applied.
   *
   * @param socket
   */
  private onReceiveSyncAction(socket: Socket) {
    return fromEvent<DownSyncActions>(socket, SyncMessageTypes.SYNC).pipe(
      tap((action) => {
        console.log('received action', action);

        const transformedAction = transformSyncAction(
          action,
          this.syncPayloadsService.getRecentActionsStore()
        );

        if (transformedAction !== null) {
          this.syncPayloadsService.saveRecentSyncAction(action);
          this.syncPayloadsService.applySyncAction(action);
        }
      })
    );
  }

  /**
   * Send selected store actions to the sync server: verify they can be propagated and that we are connected.
   * If not connected we want to rely on full environment syncs upon reconnection, instead of sending the buffered updates as it's harder to manage and can be lost if application is closed, etc.
   * If the action is an update, we group it with other updates of the same type and key, and merge their properties, if they happen in a 1s timeframe (debounce).
   * Other actions are sent immediately.
   *
   * @param socket
   * @returns
   */
  private propagateStoreActions() {
    const randomDelay = RandomInt(3000, 10000);
    console.log('randomDelay', randomDelay);

    return this.store.getStoreActions().pipe(
      map((action) => action.payload),
      filter((action) =>
        this.syncPayloadsService.canPropagateReducerAction(action)
      ),
      map((action) =>
        this.syncPayloadsService.reducerActionToSyncActionBuilder(
          action,
          this.timeDifference
        )
      ),
      // group updates actions and other actions
      groupBy((syncAction) => updatesSyncActionsList.includes(syncAction.type)),
      mergeMap((groupedSyncActions$) => {
        // UPDATES actions
        if (groupedSyncActions$.key) {
          return groupedSyncActions$.pipe(
            // group update actions by key
            groupBy((syncAction: UpdatesSyncActions) =>
              buildSyncActionKey(syncAction)
            ),
            mergeMap((groupedUpdateSyncActions$) => {
              let shouldReset = false;

              return groupedUpdateSyncActions$.pipe(
                // merge properties of all actions of the same key, in a 1s timeframe
                scan<UpdatesSyncActions, UpdatesSyncActions>(
                  (acc, curr: UpdatesSyncActions) => {
                    if (shouldReset) {
                      shouldReset = false;

                      acc = {} as UpdatesSyncActions;
                    }

                    return {
                      ...acc,
                      ...curr,
                      // always keep the first timestamp to avoid an older action winning during the grouping delay (debounce 1000)
                      timestamp: acc.timestamp ?? curr.timestamp,
                      properties: { ...acc.properties, ...curr.properties }
                    } as any;
                  },
                  {} as UpdatesSyncActions
                ),
                debounceTime(1000),
                tap(() => {
                  shouldReset = true;
                })
              );
            })
          );
        }

        // immediately send other actions
        return groupedSyncActions$;
      }),
      tap((syncAction) => {
        this.syncPayloadsService.saveRecentSyncAction(syncAction);
        console.log('emit action', syncAction);
      }),
      /* TBR */
      //delay(randomDelay),
      tap((syncAction) => {
        if (!syncAction) {
          return;
        }

        // if we are not connected, we don't buffer actions, we will either push or pull depending on the environment list
        if (!this.socket.disconnected) {
          this.socket.emit(
            SyncMessageTypes.SYNC,
            syncAction,
            this.messageAcknowledgmentCallback(syncAction)
          );
        }
      })
    );
  }

  /**
   * Listen for presence updates
   *
   * @param socket
   * @returns
   */
  private onPresenceUpdate(socket: Socket) {
    return fromEvent<SyncPresence>(socket, SyncMessageTypes.PRESENCE).pipe(
      tap((presence) => {
        this.store.update(updateSyncAction({ presence }));
      })
    );
  }

  /**
   * Listen for alerts message that can be displayed to the user in the environment list
   *
   * @param socket
   * @returns
   */
  private onAlert(socket: Socket) {
    return fromEvent<SyncMessageTypes>(socket, SyncMessageTypes.ALERT).pipe(
      tap((alert) => {
        this.store.update(updateSyncAction({ alert }));
      })
    );
  }

  /**
   * Send a get full environment action to the server
   *
   * @param environmentUuid
   */
  private sendGetFullEnvironment(environmentUuid: string) {
    const getFullEnvAction =
      this.syncPayloadsService.getFullEnvironmentActionBuilder(
        environmentUuid,
        this.timeDifference
      );

    this.socket.emit(
      SyncMessageTypes.SYNC,
      getFullEnvAction,
      this.messageAcknowledgmentCallback(getFullEnvAction)
    );
  }

  /**
   * Send an update full environment action to the server
   *
   * @param environmentUuid
   */
  private sendUpdateFullEnvironment(environmentUuid: string) {
    const updateFullEnvAction =
      this.syncPayloadsService.updateFullEnvironmentActionBuilder(
        this.store.getEnvironmentByUUID(environmentUuid),
        this.timeDifference
      );

    this.socket.emit(
      SyncMessageTypes.SYNC,
      updateFullEnvAction,
      this.messageAcknowledgmentCallback(updateFullEnvAction)
    );
  }

  /**
   * Process the acknowledgment from the server
   *
   * @param syncAction
   */
  private messageAcknowledgmentCallback(syncAction: SyncActions) {
    return (acknowledgment: ServerAcknowledgment) => {
      console.log(acknowledgment);

      if ('environmentUuid' in syncAction && acknowledgment.hash) {
        this.store.update(
          updateSettingsEnvironmentDescriptorAction({
            uuid: syncAction.environmentUuid,
            lastServerHash: acknowledgment.hash
          })
        );
      }
    };
  }

  /**
   * Set the device ID in local storage if not already set
   */
  private setDeviceId() {
    this.deviceId = localStorage.getItem('deviceId');

    if (!this.deviceId) {
      this.deviceId = generateUUID();
      localStorage.setItem('deviceId', this.deviceId);
    }
  }

  /**
   * Request the list of environments from the server
   */
  private requestEnvironmentList() {
    this.socket.emit(SyncMessageTypes.ENV_LIST);
  }

  /**
   * Calculate the time difference between the client and the server.
   * Send a message and wait for the acknoledgement to calculate the roundtrip time.
   */
  private calculateTimeDifference() {
    const timeStart = Date.now();

    this.socket.emit(SyncMessageTypes.TIME, (data: BaseSyncAction) => {
      // roundtrip time
      const timeEnd = Date.now();
      const roundtripTime = timeEnd - timeStart;
      this.timeDifference = data.timestamp - timeStart - roundtripTime / 2;
    });
  }
}
