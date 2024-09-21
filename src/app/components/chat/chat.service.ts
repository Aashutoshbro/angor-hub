import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, throwError, of, Subscriber, from } from 'rxjs';
import { catchError, filter, map, switchMap, take, takeUntil, tap } from 'rxjs/operators';
import { DomSanitizer } from '@angular/platform-browser';
import { Chat, Contact, Profile } from 'app/components/chat/chat.types';
import { IndexedDBService } from 'app/services/indexed-db.service';
import { MetadataService } from 'app/services/metadata.service';
import { SignerService } from 'app/services/signer.service';
import { Filter, nip04, NostrEvent } from 'nostr-tools';
import { RelayService } from 'app/services/relay.service';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { getEventHash } from 'nostr-tools';

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
    private chatList: Chat[] = [];
    private latestMessageTimestamps: { [pubKey: string]: number } = {};
    private messageQueue: NostrEvent[] = [];
    private isDecrypting = false;

    private _chat: BehaviorSubject<Chat | null> = new BehaviorSubject(null);
    private _chats: BehaviorSubject<Chat[] | null> = new BehaviorSubject(null);
    private _contact: BehaviorSubject<Contact | null> = new BehaviorSubject(null);
    private _contacts: BehaviorSubject<Contact[] | null> = new BehaviorSubject(null);
    private _profile: BehaviorSubject<Profile | null> = new BehaviorSubject(null);
    private _unsubscribeAll: Subject<void> = new Subject<void>();

    constructor(
        private _metadataService: MetadataService,
        private _signerService: SignerService,
        private _indexedDBService: IndexedDBService,
        private _relayService: RelayService,
        private _sanitizer: DomSanitizer
    ) {}

    // Getters for observables
    get chat$(): Observable<Chat | null> {
        return this._chat.asObservable();
    }

    get chats$(): Observable<Chat[] | null> {
        return this._chats.asObservable();
    }

    get contact$(): Observable<Contact | null> {
        return this._contact.asObservable();
    }

    get contacts$(): Observable<Contact[] | null> {
        return this._contacts.asObservable();
    }

    get profile$(): Observable<Profile | null> {
        return this._profile.asObservable();
    }

    // Fetch a contact by public key
    async getContact(pubkey: string): Promise<void> {
        try {
            const metadata = await this._metadataService.fetchMetadataWithCache(pubkey);
            if (metadata) {
                const contact: Contact = {
                    pubKey: pubkey,
                    displayName: metadata.name,
                    picture: metadata.picture,
                    about: metadata.about
                };
                this._contact.next(contact);

                // Subscribe to metadata stream for updates
                this._indexedDBService.getMetadataStream()
                    .pipe(takeUntil(this._unsubscribeAll))
                    .subscribe((updatedMetadata) => {
                        if (updatedMetadata && updatedMetadata.pubkey === pubkey) {
                            const updatedContact: Contact = {
                                pubKey: pubkey,
                                displayName: updatedMetadata.metadata.name,
                                picture: updatedMetadata.metadata.picture,
                                about: updatedMetadata.metadata.about
                            };
                            this._contact.next(updatedContact);
                        }
                    });
            }
        } catch (error) {
            console.error('Error fetching contact metadata:', error);
        }
    }

    // Fetch contacts from IndexedDB and subscribe to real-time updates
    getContacts(): Observable<Contact[]> {
        return new Observable<Contact[]>((observer) => {
            this._indexedDBService.getAllUsers()
                .then((cachedContacts: Contact[]) => {
                    if (cachedContacts.length > 0) {
                        this._contacts.next(cachedContacts);
                        observer.next(cachedContacts);
                    }
                    const pubkeys = cachedContacts.map(contact => contact.pubKey);
                    if (pubkeys.length > 0) {
                        this.subscribeToRealTimeContacts(pubkeys, observer);
                    }
                })
                .catch((error) => {
                    console.error('Error loading cached contacts from IndexedDB:', error);
                    observer.error(error);
                });

            return () => {
                console.log('Unsubscribing from contacts updates.');
            };
        });
    }

    // Subscribe to real-time updates for contacts
    private subscribeToRealTimeContacts(pubkeys: string[], observer: Subscriber<Contact[]>): void {
        this._metadataService.fetchMetadataForMultipleKeys(pubkeys)
            .then((metadataList: any[]) => {
                const updatedContacts = [...(this._contacts.value || [])];

                metadataList.forEach((metadata) => {
                    const contactIndex = updatedContacts.findIndex(c => c.pubKey === metadata.pubkey);
                    const newContact = {
                        pubKey: metadata.pubkey,
                        displayName: metadata.name,
                        picture: metadata.picture,
                        about: metadata.about
                    };

                    if (contactIndex !== -1) {
                        updatedContacts[contactIndex] = { ...updatedContacts[contactIndex], ...newContact };
                    } else {
                        updatedContacts.push(newContact);
                    }
                });

                this._contacts.next(updatedContacts);
                observer.next(updatedContacts);
            })
            .catch((error) => {
                console.error('Error fetching metadata for contacts:', error);
                observer.error(error);
            });
    }

    // Fetch profile of the user
    async getProfile(): Promise<void> {
        try {
            const publicKey = this._signerService.getPublicKey();
            const metadata = await this._metadataService.fetchMetadataWithCache(publicKey);
            if (metadata) {
                this._profile.next(metadata);

                // Subscribe to updates in the metadata stream
                this._indexedDBService.getMetadataStream()
                    .pipe(takeUntil(this._unsubscribeAll))
                    .subscribe((updatedMetadata) => {
                        if (updatedMetadata && updatedMetadata.pubkey === publicKey) {
                            this._profile.next(updatedMetadata.metadata);
                        }
                    });
            }
        } catch (error) {
            console.error('Error fetching profile metadata:', error);
        }
    }









// Fetch chats and subscribe to updates, including messages
async getChats(): Promise<Observable<Chat[]>> {
    const pubkey = this._signerService.getPublicKey();
    const useExtension = await this._signerService.isUsingExtension();
    const decryptedPrivateKey = await this._signerService.getSecretKey("123");
    this.subscribeToChatList(pubkey, useExtension, decryptedPrivateKey);

    // Optionally fetch older messages (history) if needed
    this.chatList.forEach(chat => this.loadChatHistory(chat.id!));

    return this.getChatListStream();
}

// Subscribe to chat list updates based on filters
// Subscribe to chat list updates based on filters
subscribeToChatList(pubkey: string, useExtension: boolean, decryptedSenderPrivateKey: string): Observable<Chat[]> {
    this._relayService.ensureConnectedRelays().then(() => {
        const filters: Filter[] = [
            { kinds: [EncryptedDirectMessage], authors: [pubkey] },
            { kinds: [EncryptedDirectMessage], '#p': [pubkey] }
        ];

        this._relayService.getPool().subscribeMany(this._relayService.getConnectedRelays(), filters, {
            onevent: async (event: NostrEvent) => {
                const otherPartyPubKey = event.pubkey === pubkey
                    ? event.tags.find(tag => tag[0] === 'p')?.[1] || ''
                    : event.pubkey;

                if (!otherPartyPubKey) return;

                const lastTimestamp = this.latestMessageTimestamps[otherPartyPubKey] || 0;
                if (event.created_at > lastTimestamp) {
                    this.latestMessageTimestamps[otherPartyPubKey] = event.created_at;
                    this.messageQueue.push(event);

                    // Update the real-time chat messages when they are processed
                    await this.processNextMessage(pubkey, useExtension, decryptedSenderPrivateKey);
                }
            },
            oneose: () => {
                console.log('Subscription closed');
                this._chats.next(this.chatList);
            }
        });
    });

    return this.getChatListStream();
}


// Process each message in the queue
 private async processNextMessage(pubkey: string, useExtension: boolean, decryptedSenderPrivateKey: string): Promise<void> {
    if (this.isDecrypting || this.messageQueue.length === 0) return;

    this.isDecrypting = true;

    try {
        while (this.messageQueue.length > 0) {
            const event = this.messageQueue.shift();
            if (!event) continue;

            const isSentByUser = event.pubkey === pubkey;
            const otherPartyPubKey = isSentByUser
                ? event.tags.find(tag => tag[0] === 'p')?.[1] || ''
                : event.pubkey;

            if (!otherPartyPubKey) continue;

            const decryptedMessage = await this.decryptReceivedMessage(
                event,
                useExtension,
                decryptedSenderPrivateKey,
                otherPartyPubKey
            );

            if (decryptedMessage) {
                const messageTimestamp = event.created_at * 1000;
                this.addOrUpdateChatList(otherPartyPubKey, decryptedMessage, messageTimestamp, isSentByUser);

                // Update UI with the latest messages
                this._chat.next(this.chatList.find(chat => chat.id === otherPartyPubKey));
            }
        }
    } catch (error) {
        console.error('Failed to decrypt message:', error);
    } finally {
        this.isDecrypting = false;
    }
}


// Add or update chat in the chat list, including messages
private addOrUpdateChatList(pubKey: string, message: string, createdAt: number, isMine: boolean): void {
    const existingChat = this.chatList.find(chat => chat.contact?.pubKey === pubKey);

    const newMessage = {
        id: `${pubKey}-${createdAt}`,
        chatId: pubKey,
        contactId: pubKey,
        isMine,
        value: message,
        createdAt: new Date(createdAt).toISOString(),
    };

    if (existingChat) {
        // Check if the message already exists to avoid duplicates
        const messageExists = existingChat.messages?.some(m => m.id === newMessage.id);

        if (!messageExists) {
            existingChat.messages = (existingChat.messages || []).concat(newMessage)
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            if (new Date(existingChat.lastMessageAt!).getTime() < createdAt) {
                existingChat.lastMessage = message;
                existingChat.lastMessageAt = new Date(createdAt).toISOString();
            }
        }
    } else {
        const newChat: Chat = {
            id: pubKey,
            contact: { pubKey },
            lastMessage: message,
            lastMessageAt: new Date(createdAt).toISOString(),
            messages: [newMessage]
        };
        this.chatList.push(newChat);
        this.fetchMetadataForPubKey(pubKey);
    }

    this.chatList.sort((a, b) => new Date(b.lastMessageAt!).getTime() - new Date(a.lastMessageAt!).getTime());
    this._chats.next(this.chatList);
}


// Fetch metadata for a public key
private fetchMetadataForPubKey(pubKey: string): void {
    this._metadataService.fetchMetadataWithCache(pubKey)
        .then(metadata => {
            const chat = this.chatList.find(chat => chat.contact?.pubKey === pubKey);
            if (chat && metadata) {
                chat.contact = { ...chat.contact, ...metadata };
                this._chats.next(this.chatList);
            }
        })
        .catch(error => {
            console.error(`Failed to fetch metadata for pubKey: ${pubKey}`, error);
        });
}

// Get chat list stream
getChatListStream(): Observable<Chat[]> {
    return this._chats.asObservable();
}

// Decrypt received message
private async decryptReceivedMessage(
    event: NostrEvent,
    useExtension: boolean,
    decryptedSenderPrivateKey: string,
    recipientPublicKey: string
): Promise<string> {
    if (useExtension) {
        return await this._signerService.decryptMessageWithExtension(event.content, recipientPublicKey);
    } else {
        return await this._signerService.decryptMessage(decryptedSenderPrivateKey, recipientPublicKey, event.content);
    }
}

// Load older chat history (if needed)
 private async loadChatHistory(pubKey: string): Promise<void> {
    const myPubKey = this._signerService.getPublicKey();

    const historyFilter: Filter[] = [
        { kinds: [EncryptedDirectMessage], authors: [myPubKey], '#p': [pubKey] },
        { kinds: [EncryptedDirectMessage], authors: [pubKey], '#p': [myPubKey] }
    ];

    console.log("Subscribing to history for chat with: ", pubKey);

    this._relayService.getPool().subscribeMany(this._relayService.getConnectedRelays(), historyFilter, {
        onevent: async (event: NostrEvent) => {
            console.log("Received historical event: ", event); // Check if the event is received
            const isSentByMe = event.pubkey === myPubKey;
            const senderOrRecipientPubKey = isSentByMe ? pubKey : event.pubkey;
            const decryptedMessage = await this.decryptReceivedMessage(
                event,
                await this._signerService.isUsingExtension(),
                await this._signerService.getSecretKey("123"),
                senderOrRecipientPubKey
            );

            if (decryptedMessage) {
                const messageTimestamp = event.created_at * 1000;

                // Add message to chat and update UI
                this.addOrUpdateChatList(pubKey, decryptedMessage, messageTimestamp, isSentByMe);
                this._chat.next(this.chatList.find(chat => chat.id === pubKey)); // Ensure UI is updated with history
            }
        },
        oneose: () => {
            console.log(`Closed subscription for loading history of chat: ${pubKey}`);
        }
    });
}


// Update chat in the chat list
updateChat(id: string, chat: Chat): Observable<Chat> {
    return this.chats$.pipe(
        take(1),
        switchMap((chats: Chat[] | null) => {
            const pubkey = chat.contact?.pubKey;

            if (!pubkey) {
                return throwError('No public key found for this chat');
            }

            const event: any = {
                kind: 4,
                pubkey: pubkey,
                content: JSON.stringify(chat),
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', pubkey]],
            };

            event.id = getEventHash(event);

            return from(this._relayService.publishEventToRelays(event)).pipe(
                map(() => {
                    if (chats) {
                        const index = chats.findIndex((item) => item.id === id);
                        if (index !== -1) {
                            chats[index] = chat;
                            this._chats.next(chats);
                        }
                    }
                    return chat;
                }),
                catchError((error) => {
                    console.error('Failed to update chat via Nostr:', error);
                    return throwError(error);
                })
            );
        })
    );
}

// Get chat by ID
// Get chat by ID
getChatById(id: string): Observable<Chat> {
    const recipientPublicKey = id;
    const pubkey = this._signerService.getPublicKey();
    const useExtension = this._signerService.isUsingExtension();
    const decryptedSenderPrivateKey = this._signerService.getSecretKey('123');

    return this.chats$.pipe(
        take(1),
        switchMap((chats: Chat[] | null) => {
            const cachedChat = chats?.find(chat => chat.id === id);
            if (cachedChat) {
                this._chat.next(cachedChat);
                console.log("Fetching chat history for: ", recipientPublicKey); // Check if this is called
                this.loadChatHistory(recipientPublicKey);
                return of(cachedChat);
            }

            const newChat: Chat = {
                id: recipientPublicKey,
                contact: { pubKey: recipientPublicKey, picture: "/images/avatars/avatar-placeholder.png" },
                lastMessage: '',
                lastMessageAt: new Date().toISOString(),
                messages: []
            };

            const updatedChats = chats ? [...chats, newChat] : [newChat];
            this._chats.next(updatedChats);
            this._chat.next(newChat);

            console.log("Fetching chat history for: ", recipientPublicKey); // Check if this is called
            this.loadChatHistory(recipientPublicKey);
            return of(newChat);
        }),
        catchError((error) => {
            console.error('Error fetching chat by id from Nostr:', error);
            return throwError(error);
        })
    );
}

// Reset chat state
resetChat(): void {
    this._chat.next(null);
}


    // Clean up on destroy
    ngOnDestroy(): void {
        this._unsubscribeAll.next();
        this._unsubscribeAll.complete();
    }
}
