import * as React from 'react';
import { FormGroup, TextArea } from 'mindkraft-ds';
import { Page } from './_page';

/** Empty and filled. Like every control, it must sit inside a `FormGroup`. */
export const States = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormGroup label="Description">
        <TextArea placeholder="Describe what this reward means to you…" style={{ minHeight: 84 }} />
      </FormGroup>
      <FormGroup label="Filled">
        <TextArea
          defaultValue="Two nights away, no laptop. Booked the week I hit level 20."
          style={{ minHeight: 84 }}
        />
      </FormGroup>
    </div>
  </Page>
);
