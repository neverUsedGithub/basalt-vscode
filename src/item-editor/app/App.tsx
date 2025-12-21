import * as mc from "../../shared/item";

import { useVsCode } from "../util/vscode";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  VscodeTextfield,
  VscodeOption,
  VscodeSingleSelect,
  VscodeButton,
  VscodeDivider,
  VscodeTabHeader,
  VscodeSplitLayout,
  VscodeTextarea,
} from "@vscode-elements/react-elements";

import * as NBT from "@basalt-nbt";

import { Panel, PanelResizeHandle, PanelGroup } from "react-resizable-panels";
import { ServerMessages, type IClientMessages } from "../../shared/proto";
import { initItemPreview, type PreviewContext } from "../util/preview";
import { hashItemTexture, hashResource } from "../util/hash";
import { ACCENTED_FONT_PATH, ASCII_FONT_PATH, GLINT_TEXTURE_PATH, NONLATIN_EUROPEAN_FONT_PATH } from "../util/constant";

// type MCText =
//   | string
//   | MCText[]
//   | {
//       type?: string;

//       text: string;
//       color?: string;
//       font?: string;

//       bold?: boolean;
//       italic?: boolean;
//       underlined?: boolean;
//       strikethrough?: boolean;
//       obfuscated?: boolean;

//       shadow_color?: number | [number, number, number, number];

//       insertion?: string;
//       click_event?: unknown;
//       hover_event?: unknown;

//       extra?: MCText[];
//     };

function ItemPreview({
  resources,
  editedItem,
  itemTextures,
}: {
  editedItem: mc.IItem | null;
  resources: Record<string, string>;
  itemTextures: Record<string, string>;
}) {
  const pixiCanvas = useRef<HTMLCanvasElement | null>(null);
  const itemPreview = useRef<PreviewContext | null>(null);

  useEffect(() => {
    async function init() {
      if (!pixiCanvas.current) return;
      itemPreview.current = await initItemPreview(pixiCanvas.current!);
    }

    init();

    return () => {
      itemPreview.current?.dispose();
      itemPreview.current = null;
    };
  }, [pixiCanvas]);

  useEffect(() => {
    if (!itemPreview.current) return;
    itemPreview.current.onTextures(itemTextures);
  }, [itemTextures]);

  useEffect(() => {
    if (!itemPreview.current) return;
    itemPreview.current.onResources(resources);
  }, [resources]);

  useEffect(() => {
    if (!itemPreview.current) return;
    itemPreview.current.onEditedItem(editedItem);
  }, [editedItem]);

  return <canvas ref={pixiCanvas}></canvas>;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) count += text[i] === "\n" ? 1 : 0;
  return count;
}

function validateItemComponents(item: mc.IItem | null): Record<string, string | null> {
  if (!item) return {};

  const validated: Record<string, string | null> = {};

  for (const component in item.components) {
    let error: string | null = null;

    try {
      NBT.parseSNBT(item.components[component]!);
    } catch (e) {
      error = (e as Error).message;
    }

    validated[component] = error;
  }

  return validated;
}

function requestResource(version: string, path: string) {
  const vsc = useVsCode();

  vsc.postMessage({
    type: "get-resource",
    version: version,
    resource: path,
  } as IClientMessages);
}

export function App() {
  const vsc = useVsCode();
  const [minecraftVersions, setMinecraftVersions] = useState<string[]>([]);
  const [itemTextures, setItemTextures] = useState<Record<string, string>>({});
  const [resources, setResources] = useState<Record<string, string>>({});
  const [editedItem, setEditedItem] = useState<mc.IItem | null>(null);
  const [itemComponents, setItemComponents] = useState<string[]>([]);
  const [addingComponent, setAddingComponent] = useState(false);
  const componentErrors = useMemo(() => validateItemComponents(editedItem), [editedItem]);
  const containerSize = useRef<number | null>(null);

  useEffect(() => {
    window.addEventListener("message", async (ev) => {
      console.log("SERVER MESSAGE", ev.data);

      const result = ServerMessages.safeParse(ev.data);
      if (!result.success) return;

      const resp = result.data;

      switch (resp.type) {
        case "update-item": {
          setEditedItem(resp.item);
          break;
        }

        case "update-versions": {
          setMinecraftVersions(resp.versions);
          break;
        }

        case "item-texture": {
          setItemTextures((textures) => ({ ...textures, [hashItemTexture(resp.item)]: resp.texture }));
          break;
        }

        case "resource": {
          setResources((resources) => ({ ...resources, [hashResource(resp.version, resp.resource)]: resp.texture }));
          break;
        }

        case "update-item-components": {
          setItemComponents(resp.components);
          break;
        }
      }
    });

    vsc.postMessage({ type: "ready" } satisfies IClientMessages);
  }, []);

  useEffect(() => {
    if (!editedItem) return;
    vsc.postMessage({ type: "update-item", item: editedItem } satisfies IClientMessages);
    vsc.postMessage({ type: "get-item-texture", item: editedItem } satisfies IClientMessages);
  }, [editedItem]);

  useEffect(() => {
    if (!editedItem) return;

    requestResource(editedItem.minecraftVersion, GLINT_TEXTURE_PATH);

    requestResource(editedItem.minecraftVersion, ASCII_FONT_PATH);
    requestResource(editedItem.minecraftVersion, ACCENTED_FONT_PATH);
    requestResource(editedItem.minecraftVersion, NONLATIN_EUROPEAN_FONT_PATH);
  }, [editedItem?.minecraftVersion]);

  function previewContainerMounted(previewParent: HTMLDivElement | null) {
    if (!previewParent) return;
    if (previewParent.dataset.mounted) return;

    previewParent.dataset.mounted = "true";

    const previewContainer = previewParent.querySelector(".preview-container")! as HTMLElement;
    let mouseOver = false;

    containerSize.current ??= 65;

    previewParent.addEventListener("mouseenter", () => (mouseOver = true));
    previewParent.addEventListener("mouseleave", () => (mouseOver = false));

    previewParent.addEventListener("wheel", (ev) => {
      if (!mouseOver) return;

      containerSize.current! += Math.sign(ev.deltaY) * -5;
      containerSize.current = Math.max(5, Math.min(containerSize.current!, 90));

      previewContainer.style.width = `${containerSize.current}%`;
    });
  }

  function minecraftVersionChanged(ev: Event) {
    // @ts-expect-error
    const minecraftVersion: string = ev.target.value;

    if (!editedItem) {
      setEditedItem({ minecraftVersion, id: "stone", count: 1, components: {} });
    } else {
      setEditedItem({ ...editedItem, minecraftVersion });
    }
  }

  function itemIdChanged(ev: Event) {
    // @ts-expect-error
    const itemId: string = ev.target.value;
    if (!editedItem) return;

    setEditedItem({ ...editedItem, id: itemId });
  }

  function itemCountChanged(ev: Event) {
    // @ts-expect-error
    const itemCount: number = parseInt(ev.target.value);
    if (!editedItem) return;

    setEditedItem({ ...editedItem, count: itemCount });
  }

  function addComponent() {
    if (!editedItem) return;
    setAddingComponent(true);
  }

  function addingComponentBlur() {
    setAddingComponent(false);
  }

  function addingComponentConfirm(ev: Event) {
    if (!editedItem) return;

    // @ts-expect-error
    const component: string = ev.target.value;

    setAddingComponent(false);
    setEditedItem({ ...editedItem, components: { ...editedItem.components, [component]: "" } });
  }

  function addingSelectMounted(element: HTMLElement | null) {
    if (!element) return;
    setTimeout(() => element.focus(), 50);
  }

  function changeComponent(component: string, value: string) {
    if (!editedItem) return;
    setEditedItem({ ...editedItem, components: { ...editedItem.components, [component]: value } });
  }

  return (
    <div className="editor">
      <PanelGroup direction="horizontal">
        <Panel defaultSize={70} className="preview-panel">
          <div className="preview" ref={previewContainerMounted}>
            <div className="preview-container">
              <ItemPreview itemTextures={itemTextures} editedItem={editedItem} resources={resources} />
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="handle" />
        <Panel className="sidepanel" defaultSize={30}>
          <div className="named-option">
            <span>Minecraft Version:</span>
            <VscodeSingleSelect
              combobox={true}
              onChange={(e) => minecraftVersionChanged(e)}
              value={editedItem?.minecraftVersion}
            >
              {minecraftVersions.map((version) => (
                <VscodeOption key={version}>{version}</VscodeOption>
              ))}
            </VscodeSingleSelect>
          </div>
          {editedItem && (
            <>
              <div className="named-option">
                <span>Item ID:</span>
                <VscodeTextfield value={editedItem!.id} onChange={itemIdChanged}></VscodeTextfield>
              </div>
              <div className="named-option">
                <span>Stack Size:</span>
                <VscodeTextfield
                  value={editedItem!.count.toString()}
                  onChange={itemCountChanged}
                  type="number"
                ></VscodeTextfield>
              </div>
              <VscodeDivider></VscodeDivider>
              <VscodeButton onClick={addComponent}>
                <i className="button-icon codicon codicon-add"></i> Add Component
              </VscodeButton>
              <div className="component-list">
                {addingComponent && (
                  <div className="component">
                    <VscodeSingleSelect
                      combobox={true}
                      value=""
                      ref={addingSelectMounted}
                      onBlur={addingComponentBlur}
                      onChange={addingComponentConfirm}
                    >
                      {itemComponents.map((component) => (
                        <VscodeOption key={component} disabled={component in editedItem.components}>
                          {component}
                        </VscodeOption>
                      ))}
                    </VscodeSingleSelect>
                  </div>
                )}

                {Object.keys(editedItem.components).map((componentId) => (
                  <div className="component">
                    <div className="component-header">
                      <VscodeSingleSelect combobox={true} value={componentId}>
                        {itemComponents.map((component) => (
                          <VscodeOption key={component} disabled={component in editedItem.components}>
                            {component}
                          </VscodeOption>
                        ))}
                      </VscodeSingleSelect>
                      <VscodeButton>
                        <i className="codicon codicon-close button-icon"></i> Remove
                      </VscodeButton>
                    </div>
                    <VscodeTextarea
                      value={editedItem.components[componentId]}
                      onChange={(ev) => changeComponent(componentId, (ev.target! as HTMLTextAreaElement).value)}
                      resize="vertical"
                      rows={countNewlines(editedItem.components[componentId]!) + 1}
                    ></VscodeTextarea>
                    {componentErrors[componentId] && (
                      <span className="component-parse-error">{componentErrors[componentId]}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
