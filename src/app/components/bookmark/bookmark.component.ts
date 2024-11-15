import { AngorCardComponent } from '@angor/components/card';
import { AngorFindByKeyPipe } from '@angor/pipes/find-by-key';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NgClass, PercentPipe, I18nPluralPipe, CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatOptionModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { BookmarkService } from 'app/services/bookmark.service';
import { Project } from 'app/interface/project.interface';
import { StorageService } from 'app/services/storage.service';
import { Observable, Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'app-bookmark',
    standalone: true,
    imports: [
        MatButtonModule,
        RouterLink,
        MatIconModule,
        AngorCardComponent,
        CdkScrollable,
        MatFormFieldModule,
        MatSelectModule,
        MatOptionModule,
        MatInputModule,
        MatSlideToggleModule,
        NgClass,
        MatTooltipModule,
        MatProgressBarModule,
        AngorFindByKeyPipe,
        PercentPipe,
        I18nPluralPipe,
        CommonModule,
    ],
    templateUrl: './bookmark.component.html',
    styleUrls: ['./bookmark.component.scss']
})
export class BookmarkComponent implements OnInit, OnDestroy {
    savedProjects: Project[] = [];
    bookmarks$: Observable<string[]>;
    private _unsubscribeAll = new Subject<any>();

    constructor(
        private _bookmarkService: BookmarkService,
        private _storageService: StorageService,
        private _router: Router,
    ) {
        this.bookmarks$ = this._bookmarkService.bookmarks$;
    }

    async ngOnInit(): Promise<void> {
        await this._bookmarkService.initializeForCurrentUser(); // Clear previous bookmarks and load current user's bookmarks
        await this.loadBookmarkedProjects();
        this.subscribeToBookmarkChanges();
    }

    trackByFn(index: number, item: Project): string | number {
        return item.projectIdentifier || index;
    }

    private async loadBookmarkedProjects(): Promise<void> {
        const bookmarkIds = await this._bookmarkService.getBookmarks();
        const projects = await this._storageService.getProjectsByIds(bookmarkIds);
        this.savedProjects = projects;
        this.fetchMetadataForProjects(this.savedProjects); // Fetch metadata for loaded projects
    }

    private subscribeToBookmarkChanges(): void {
        this.bookmarks$.pipe(takeUntil(this._unsubscribeAll)).subscribe(async (bookmarkIds) => {
            const projects = await this._storageService.getProjectsByIds(bookmarkIds);
            this.savedProjects = projects;
            this.fetchMetadataForProjects(this.savedProjects); // Fetch metadata for updated projects
        });
    }

    private fetchMetadataForProjects(projects: Project[]): void {
        projects.forEach(project => {
            this._storageService.getProfile(project.nostrPubKey).then(profileMetadata => {
                if (profileMetadata) {
                    this.updateProjectMetadata(project, profileMetadata);
                }
            });
        });
    }

    private updateProjectMetadata(project: Project, metadata: any): void {
        project.displayName = metadata.name || project.displayName;
        project.about = metadata.about || project.about;
        project.picture = metadata.picture || project.picture;
        project.banner = metadata.banner || project.banner;
    }

    async toggleBookmark(projectId: string): Promise<void> {
        const isBookmarked = await this._bookmarkService.isBookmarked(projectId);
        if (isBookmarked) {
            await this._bookmarkService.removeBookmark(projectId);
        } else {
            await this._bookmarkService.addBookmark(projectId);
        }
    }

    ngOnDestroy(): void {
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }

    goToProjectDetails(project: Project): void {
        this._router.navigate(['/profile', project.nostrPubKey]);
    }
    openChat(pubKey : string): void
    {
        this._router.navigate(['/chat', pubKey]);
    }

}
