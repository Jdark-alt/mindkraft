import * as React from 'react';
import { FormGroup, Select } from 'mindkraft-ds';
import { Page } from './_page';

/** The frequency picker from the activity editor. */
export const Frequency = () => (
  <Page>
    <FormGroup label="Frequency">
      <Select defaultValue="daily">
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Bi-weekly</option>
        <option value="monthly">Monthly</option>
        <option value="custom">Custom</option>
      </Select>
    </FormGroup>
  </Page>
);

/** Two selects side by side, the density a modal row uses. */
export const Pair = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormGroup label="Dimension">
        <Select defaultValue="health">
          <option value="health">Health</option>
          <option value="career">Career</option>
          <option value="mind">Mind</option>
        </Select>
      </FormGroup>
      <FormGroup label="Path">
        <Select defaultValue="movement">
          <option value="movement">Movement</option>
          <option value="nutrition">Nutrition</option>
        </Select>
      </FormGroup>
    </div>
  </Page>
);
