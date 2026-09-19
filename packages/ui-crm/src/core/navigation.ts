export interface CrmNavigation {
  contacts(): void;
  contact(id: string): void;
  editContact(id: string): void;
  newContact(): void;
  importContacts(): void;
  lists(): void;
  list(id: string): void;
  suppression(): void;
  campaigns(): void;
  campaign(id: string): void;
  editCampaign(id: string): void;
  newCampaign(): void;
  recipients(id: string): void;
  analytics(id: string): void;
}
