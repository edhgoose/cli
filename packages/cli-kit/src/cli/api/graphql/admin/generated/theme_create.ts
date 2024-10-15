/* eslint-disable @typescript-eslint/consistent-type-definitions */
import * as Types from './types.js'

import {TypedDocumentNode as DocumentNode} from '@graphql-typed-document-node/core'

export type ThemeCreateMutationVariables = Types.Exact<{
  source: Types.Scalars['URL']['input']
  name?: Types.InputMaybe<Types.Scalars['String']['input']>
}>

export type ThemeCreateMutation = {
  themeCreate?: {
    theme?: {id: string; name: string; role: Types.ThemeRole} | null
    userErrors: {field?: string[] | null; message: string}[]
  } | null
}

export const ThemeCreate = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: {kind: 'Name', value: 'themeCreate'},
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {kind: 'Variable', name: {kind: 'Name', value: 'source'}},
          type: {kind: 'NonNullType', type: {kind: 'NamedType', name: {kind: 'Name', value: 'URL'}}},
        },
        {
          kind: 'VariableDefinition',
          variable: {kind: 'Variable', name: {kind: 'Name', value: 'name'}},
          type: {kind: 'NamedType', name: {kind: 'Name', value: 'String'}},
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: {kind: 'Name', value: 'themeCreate'},
            arguments: [
              {
                kind: 'Argument',
                name: {kind: 'Name', value: 'source'},
                value: {kind: 'Variable', name: {kind: 'Name', value: 'source'}},
              },
              {
                kind: 'Argument',
                name: {kind: 'Name', value: 'name'},
                value: {kind: 'Variable', name: {kind: 'Name', value: 'name'}},
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: {kind: 'Name', value: 'theme'},
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {kind: 'Field', name: {kind: 'Name', value: 'id'}},
                      {kind: 'Field', name: {kind: 'Name', value: 'name'}},
                      {kind: 'Field', name: {kind: 'Name', value: 'role'}},
                      {kind: 'Field', name: {kind: 'Name', value: '__typename'}},
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: {kind: 'Name', value: 'userErrors'},
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {kind: 'Field', name: {kind: 'Name', value: 'field'}},
                      {kind: 'Field', name: {kind: 'Name', value: 'message'}},
                      {kind: 'Field', name: {kind: 'Name', value: '__typename'}},
                    ],
                  },
                },
                {kind: 'Field', name: {kind: 'Name', value: '__typename'}},
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ThemeCreateMutation, ThemeCreateMutationVariables>
