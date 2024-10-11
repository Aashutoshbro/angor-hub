import { AngorHorizontalNavigationComponent } from '@angor/components/navigation/horizontal/horizontal.component';
import { AngorNavigationService } from '@angor/components/navigation/navigation.service';
import { AngorNavigationItem } from '@angor/components/navigation/navigation.types';
import { NgClass } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    inject,
    Input,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'angor-horizontal-navigation-spacer-item',
    templateUrl: './spacer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [NgClass],
})
export class AngorHorizontalNavigationSpacerItemComponent
    implements OnInit, OnDestroy
{
    private _changeDetectorRef = inject(ChangeDetectorRef);
    private _angorNavigationService = inject(AngorNavigationService);

    @Input() item: AngorNavigationItem;
    @Input() name: string;

    private _angorHorizontalNavigationComponent: AngorHorizontalNavigationComponent;
    private _unsubscribeAll: Subject<any> = new Subject<any>();

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On init
     */
    ngOnInit(): void {
        // Get the parent navigation component
        this._angorHorizontalNavigationComponent =
            this._angorNavigationService.getComponent(this.name);

        // Subscribe to onRefreshed on the navigation component
        this._angorHorizontalNavigationComponent.onRefreshed
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe(() => {
                // Mark for check
                this._changeDetectorRef.markForCheck();
            });
    }

    /**
     * On destroy
     */
    ngOnDestroy(): void {
        // Unsubscribe from all subscriptions
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }
}
