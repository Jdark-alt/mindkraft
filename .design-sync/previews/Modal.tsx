import * as React from 'react';
import { Modal, Button, FormGroup, TextInput, TextArea } from 'mindkraft-ds';
import { Viewport } from './_page';

/**
 * The planner's add dialog, as the app composes it: eyebrow, title, fields,
 * then Cancel and the one blue confirm.
 */
export const AddToSchedule = () => (
  <Viewport>
    <Modal
      eyebrow="Daily Planner"
      title="Add to schedule"
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button>Add</Button>
        </>
      }
    >
      <FormGroup label="Time">
        <TextInput placeholder="09:30" />
      </FormGroup>
      <div style={{ height: 14 }} />
      <FormGroup label="Activity">
        <TextInput placeholder="Search activities…" />
      </FormGroup>
    </Modal>
  </Viewport>
);

/** A longer form — the reward editor, with a textarea and a link field. */
export const EditReward = () => (
  <Viewport height={620}>
    <Modal
      title="Set Reward for Level 20"
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button>Save Reward</Button>
        </>
      }
    >
      <FormGroup label="Reward Title">
        <TextInput defaultValue="Weekend Getaway" />
      </FormGroup>
      <div style={{ height: 14 }} />
      <FormGroup label="Description">
        <TextArea placeholder="Describe what this reward means to you…" style={{ minHeight: 84 }} />
      </FormGroup>
      <div style={{ height: 14 }} />
      <FormGroup label="Link">
        <TextInput type="url" placeholder="https://…" />
      </FormGroup>
    </Modal>
  </Viewport>
);
