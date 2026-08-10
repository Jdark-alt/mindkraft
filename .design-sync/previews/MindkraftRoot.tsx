import * as React from 'react';
import {
  MindkraftRoot,
  SubTabs,
  SubTab,
  ActionToolbar,
  ToolCluster,
  ToolbarButton,
  ToolDivider,
  ToolbarCount,
  ToolbarAddButton,
  ActivityListItem,
} from 'mindkraft-ds';
import { Page } from './_page';

/**
 * A whole surface inside the shell — this is the composition every Mindkraft
 * screen starts from: root → sub-tabs → toolbar → content.
 */
export const Shell = () => (
  <Page>
    <MindkraftRoot>
      <SubTabs>
        <SubTab active>My Activities</SubTab>
        <SubTab>Categories</SubTab>
        <SubTab>Map</SubTab>
      </SubTabs>
      <ActionToolbar>
        <ToolCluster>
          <ToolbarButton icon="grid" />
          <ToolDivider />
          <ToolbarButton icon="filter" showDot />
          <ToolDivider />
          <ToolbarButton icon="search" />
        </ToolCluster>
        <ToolbarCount>8 of 20</ToolbarCount>
        <ToolbarAddButton />
      </ActionToolbar>
      <ActivityListItem name="Morning Walk" xp={15} streak={4} dimension="green" />
      <ActivityListItem name="Meditate" xp={10} streak={12} dimension="teal" state="completed" showUndo />
      <ActivityListItem name="Read 20 pages" xp={20} streak={5} dimension="indigo" />
    </MindkraftRoot>
  </Page>
);

/** Without the `main-content` wrapper, for a surface that owns its own padding. */
export const BareContainer = () => (
  <Page>
    <MindkraftRoot mainContent={false}>
      <ActivityListItem name="Weekly Review" xp={40} streak={2} dimension="purple" />
    </MindkraftRoot>
  </Page>
);
