import * as React from 'react';
import { FormGroup, TextInput } from 'mindkraft-ds';
import { Page } from './_page';

/** Empty and filled — both inside a `FormGroup`, which is what styles them. */
export const States = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormGroup label="Reward Title">
        <TextInput placeholder="e.g., Weekend Getaway…" />
      </FormGroup>
      <FormGroup label="Filled">
        <TextInput defaultValue="Weekend Getaway" />
      </FormGroup>
    </div>
  </Page>
);

/** The input types the app's forms use. */
export const Types = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormGroup label="Link">
        <TextInput type="url" placeholder="https://…" />
      </FormGroup>
      <FormGroup label="Target">
        <TextInput type="number" defaultValue={30} />
      </FormGroup>
      <FormGroup label="Ends">
        <TextInput type="date" defaultValue="2026-09-12" />
      </FormGroup>
    </div>
  </Page>
);
