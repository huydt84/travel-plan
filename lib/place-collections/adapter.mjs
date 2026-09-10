/**
 * Provider boundary for public shared-place lists.
 *
 * @typedef {{kind:string,value:string}} ExternalPlaceId
 * @typedef {{position:number,name:string,address:string|null,latitude:number|null,longitude:number|null,note:string,mapsUrl:string,sourceCreatedAt:string|null,sourceUpdatedAt:string|null,externalIds:ExternalPlaceId[]}} CollectionSnapshotItem
 * @typedef {{provider:string,externalId:string,publicUrl:string,title:string,description:string,parserVersion:string,sourceUpdatedAt:string|null,warnings:Array<object>,items:CollectionSnapshotItem[]}} CollectionSnapshot
 * @typedef {{provider:string,supports:(url:string)=>boolean,fetchSnapshot:(url:string,options?:{signal?:AbortSignal})=>Promise<CollectionSnapshot>}} SharedCollectionAdapter
 */

export function assertCollectionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.provider !== "string" || typeof snapshot.externalId !== "string" || !Array.isArray(snapshot.items))
    throw new TypeError("Shared collection adapter returned an invalid snapshot");
  return snapshot;
}
