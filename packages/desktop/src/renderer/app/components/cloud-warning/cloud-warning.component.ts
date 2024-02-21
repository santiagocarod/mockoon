import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-cloud-warning',
  templateUrl: 'cloud-warning.component.html',
  styleUrls: ['cloud-warning.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CloudWarningComponent implements OnInit {
  constructor() {}

  ngOnInit() {}
}
