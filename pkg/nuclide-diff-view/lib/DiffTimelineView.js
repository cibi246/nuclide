'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type DiffViewModel from './DiffViewModel';
import type {RevisionInfo} from '../../nuclide-hg-rpc/lib/HgService';
import type {
  RevisionStatusDisplay,
} from '../../nuclide-hg-repository-client/lib/HgRepositoryClient';

import {CompositeDisposable} from 'atom';
import {React} from 'react-for-atom';
import RevisionTimelineNode from './RevisionTimelineNode';
import UncommittedChangesTimelineNode from './UncommittedChangesTimelineNode';
import {DiffMode} from './constants';
import {
  Button,
  ButtonSizes,
} from '../../nuclide-ui/Button';

type DiffTimelineViewProps = {
  diffModel: DiffViewModel,
  onSelectionChange: (revisionInfo: RevisionInfo) => any,
};

export default class DiffTimelineView extends React.Component {
  props: DiffTimelineViewProps;
  _subscriptions: CompositeDisposable;

  constructor(props: DiffTimelineViewProps) {
    super(props);
    this._subscriptions = new CompositeDisposable();
    (this: any)._updateRevisions = this._updateRevisions.bind(this);
    (this: any)._handleClickPublish = this._handleClickPublish.bind(this);
  }

  componentDidMount(): void {
    const {diffModel} = this.props;
    this._subscriptions.add(
      diffModel.onDidUpdateState(this._updateRevisions),
    );
  }

  _updateRevisions(): void {
    this.forceUpdate();
  }

  render(): ?React.Element<any> {
    let content = null;
    const {diffModel, onSelectionChange} = this.props;
    const {activeRepositoryState} = diffModel.getState();
    if (activeRepositoryState.headRevision == null) {
      content = 'Revisions not loaded...';
    } else {
      const {
        compareRevisionId,
        headRevision,
        revisionStatuses,
        headToForkBaseRevisions,
      } = activeRepositoryState;
      content = (
        <RevisionsTimelineComponent
          diffModel={diffModel}
          compareRevisionId={compareRevisionId || headRevision.id}
          dirtyFileCount={diffModel.getDirtyFileChangesCount()}
          onSelectionChange={onSelectionChange}
          onClickPublish={this._handleClickPublish}
          revisions={headToForkBaseRevisions}
          revisionStatuses={revisionStatuses}
        />
      );
    }

    return (
      <div className="nuclide-diff-timeline padded">
        {content}
      </div>
    );
  }

  _handleClickPublish(): void {
    const {diffModel} = this.props;
    diffModel.setViewMode(DiffMode.PUBLISH_MODE);
  }

  componentWillUnmount(): void {
    this._subscriptions.dispose();
  }
}

type RevisionsComponentProps = {
  diffModel: DiffViewModel,
  compareRevisionId: number,
  dirtyFileCount: number,
  onSelectionChange: (revisionInfo: RevisionInfo) => mixed,
  onClickPublish: () => mixed,
  revisions: Array<RevisionInfo>,
  revisionStatuses: Map<number, RevisionStatusDisplay>,
};

function RevisionsTimelineComponent(props: RevisionsComponentProps): React.Element<any> {

  const {revisions, compareRevisionId, revisionStatuses} = props;
  const latestToOldestRevisions = revisions.slice().reverse();
  const selectedIndex = latestToOldestRevisions.findIndex(
    revision => revision.id === compareRevisionId,
  );

  return (
    <div className="revision-timeline-wrap">
      <Button
        className="pull-right"
        size={ButtonSizes.SMALL}
        onClick={props.onClickPublish}>
        Publish to Phabricator
      </Button>
      <h5 style={{marginTop: 0}}>Compare Revisions</h5>
      <div className="revision-selector">
        <div className="revisions">
          <UncommittedChangesTimelineNode
            diffModel={props.diffModel}
            dirtyFileCount={props.dirtyFileCount}
          />
          {latestToOldestRevisions.map((revision, i) =>
            <RevisionTimelineNode
              index={i}
              key={revision.hash}
              selectedIndex={selectedIndex}
              revision={revision}
              revisionStatus={revisionStatuses.get(revision.id)}
              revisionsCount={revisions.length}
              onSelectionChange={props.onSelectionChange}
            />,
          )}
        </div>
      </div>
    </div>
  );

}
