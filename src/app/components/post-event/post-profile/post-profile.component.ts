import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { StorageService } from 'app/services/storage.service';
import { CommonModule } from '@angular/common';
import { AgoPipe } from "../../../shared/pipes/ago.pipe";

@Component({
  selector: 'app-post-profile',
  standalone: true,
  templateUrl: './post-profile.component.html',
  styleUrls: ['./post-profile.component.scss'],
  imports: [CommonModule, AgoPipe]
})
export class PostProfileComponent implements OnInit, OnDestroy {
  @Input() pubkey!: string;
  @Input() avatarUrl?: string;
  @Input() created_at?: string;

  user: any;
  private subscription!: Subscription;
   constructor(
    private _changeDetectorRef: ChangeDetectorRef,
    private _storageService: StorageService
  ) {}

  ngOnInit(): void {
    this.loadUserProfile();

    this.subscription = this._storageService.profile$.subscribe((data) => {
      if (data && data.pubKey === this.pubkey) {
        this.user = data.metadata;
        this._changeDetectorRef.detectChanges();
      }
    });
  }

  private async loadUserProfile(): Promise<void> {
    const metadata = await this._storageService.getProfile(this.pubkey);
    this.user = metadata || {};
    this._changeDetectorRef.detectChanges();
  }

  get displayName(): string {
    return this.user?.display_name || this.user?.name || this.shortenPubkey(this.pubkey);
  }

  get displayAvatar(): string {
    return this.user?.picture || this.avatarUrl || '/images/avatars/avatar-placeholder.png';
  }

  shortenPubkey(pubkey: string): string {
    if (!pubkey) return '';
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
}
