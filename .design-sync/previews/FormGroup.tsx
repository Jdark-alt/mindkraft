import * as React from 'react';
import { FormGroup, TextInput, TextArea, Select } from 'mindkraft-ds';
import { Page } from './_page';

/** A labelled text field — the shape every Mindkraft form is built from. */
export const Default = () => (
  <Page>
    <FormGroup label="Reward Title" htmlFor="rewardTitle">
      <TextInput id="rewardTitle" placeholder="e.g., Weekend Getaway, New Sneakers…" />
    </FormGroup>
  </Page>
);

/** A stack of fields — text, select, textarea — as a modal body composes them. */
export const Stack = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormGroup label="Activity Name">
        <TextInput placeholder="Morning Walk" />
      </FormGroup>
      <FormGroup label="Frequency">
        <Select defaultValue="daily">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Custom</option>
        </Select>
      </FormGroup>
      <FormGroup label="Description">
        <TextArea placeholder="Why does this matter to you?" style={{ minHeight: 72 }} />
      </FormGroup>
    </div>
  </Page>
);

/** A filled field, so the input's resting state is visible next to a placeholder. */
export const Filled = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormGroup label="Reward Title">
        <TextInput defaultValue="Weekend Getaway" />
      </FormGroup>
      <FormGroup label="Link">
        <TextInput type="url" placeholder="https://…" />
      </FormGroup>
    </div>
  </Page>
);
