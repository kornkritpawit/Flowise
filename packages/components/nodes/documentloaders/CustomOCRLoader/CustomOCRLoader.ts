import { IDocument, ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { TextSplitter } from 'langchain/text_splitter'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { getFileFromStorage, handleEscapeCharacters, INodeOutputsValue } from '../../../src'
import { getCredentialData, getCredentialParam } from '../../../src/utils'
import { Document } from '@langchain/core/documents'

class CustomOCR_DocumentLoader implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]
    outputs: INodeOutputsValue[]

    // Class properties for Custom OCR API
    private customOcrApiUrl?: string
    private customOcrApiKey?: string
    private textSplitter?: TextSplitter
    private usage?: string

    constructor() {
        this.label = 'Custom OCR PDF Loader'
        this.name = 'customOcr'
        this.version = 2.0
        this.type = 'Document'
        this.icon = 'customOcr.svg'
        this.category = 'Document Loaders'
        this.description = `Upload file to external url to process files`
        this.baseClasses = [this.type]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['customOcrApi'],
            optional: true
        }
        this.inputs = [
            {
                label: 'File Upload',
                name: 'processFile',
                type: 'file',
                fileType: '.txt, .text, .pdf, .docx, .doc, .xlsx, .xls, .csv, .jpg, .jpeg, .png',
                description: 'Upload text, PDF, Office files (Word, Excel), images, or CSV files'
            },
            {
                label: 'Custom OCR API URL',
                name: 'customOcrApiUrl',
                type: 'string',
                description: 'URL ของ Custom OCR API endpoint',
                placeholder: 'http://localhost:8000/api/process',
                optional: true
            },
            {
                label: 'Text Splitter',
                name: 'textSplitter',
                type: 'TextSplitter',
                optional: true
            },
            {
                label: 'Usage',
                name: 'usage',
                type: 'options',
                options: [
                    {
                        label: 'One document per page',
                        name: 'perPage'
                    },
                    {
                        label: 'One document per file',
                        name: 'perFile'
                    }
                ],
                default: 'perPage'
            },
            {
                label: 'Additional Metadata',
                name: 'metadata',
                type: 'json',
                description: 'Additional metadata to be added to the extracted documents',
                optional: true,
                additionalParams: true
            }
        ]
        this.outputs = [
            {
                label: 'Document',
                name: 'document',
                description: 'Array of document objects containing metadata and pageContent',
                baseClasses: [...this.baseClasses, 'json']
            },
            {
                label: 'Text',
                name: 'text',
                description: 'Concatenated string from pageContent of documents',
                baseClasses: ['string', 'json']
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        // Set class properties
        this.textSplitter = nodeData.inputs?.textSplitter as TextSplitter
        this.customOcrApiUrl = nodeData.inputs?.customOcrApiUrl as string
        this.usage = nodeData.inputs?.usage as string

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        this.customOcrApiKey = getCredentialParam('customOcrApiKey', credentialData, nodeData)

        const pdfFileBase64 = nodeData.inputs?.processFile as string
        const fileBase64 =
            nodeData.inputs?.processFile ||
            nodeData.inputs?.txtFile ||
            nodeData.inputs?.yamlFile ||
            nodeData.inputs?.docxFile ||
            nodeData.inputs?.jsonlinesFile ||
            nodeData.inputs?.csvFile ||
            nodeData.inputs?.jsonFile ||
            (nodeData.inputs?.fileObject as string)

        const metadata = nodeData.inputs?.metadata
        const legacyBuild = nodeData.inputs?.legacyBuild as boolean
        const output = nodeData.outputs?.output as string
        const usage = this.usage

        let docs: IDocument[] = []
        let files: string[] = []

        if (fileBase64) {
            //FILE-STORAGE::["CONTRIBUTING.md","LICENSE.md","README.md"]
            if (fileBase64.startsWith('FILE-STORAGE::')) {
                const fileName = fileBase64.replace('FILE-STORAGE::', '')
                if (fileName.startsWith('[') && fileName.endsWith(']')) {
                    files = JSON.parse(fileName)
                } else {
                    files = [fileName]
                }
                const orgId = options.orgId
                const chatflowid = options.chatflowid

                for (const file of files) {
                    if (!file) continue
                    const fileData = await getFileFromStorage(file, orgId, chatflowid)
                    const bf = fileData instanceof Buffer ? fileData : Buffer.from(fileData)

                    // ถ้ามี Custom OCR API URL ให้ใช้ Custom API
                    if (this.customOcrApiUrl && this.customOcrApiKey) {
                        const customDocs = await this.postFilesToCustomApi(bf, file)
                        if (this.textSplitter) {
                            const splittedDocs = await this.textSplitter.splitDocuments(customDocs)
                            docs.push(...splittedDocs)
                        } else {
                            docs.push(...customDocs)
                        }
                    } else {
                        // ใช้ PDFLoader ปกติ
                        await this.extractDocs(usage, bf, legacyBuild, this.textSplitter, docs)
                    }
                }
            } else {
                if (fileBase64.startsWith('[') && fileBase64.endsWith(']')) {
                    files = JSON.parse(fileBase64)
                } else {
                    files = [fileBase64]
                }

                for (const file of files) {
                    if (!file) continue
                    const splitDataURI = file.split(',')
                    const filename = splitDataURI.pop()?.split(':')[1] ?? ''
                    const bf = Buffer.from(splitDataURI.pop() || '', 'base64')

                    // ถ้ามี Custom OCR API URL ให้ใช้ Custom API
                    if (this.customOcrApiUrl && this.customOcrApiKey) {
                        const customDocs = await this.postFilesToCustomApi(bf, filename)
                        if (this.textSplitter) {
                            const splittedDocs = await this.textSplitter.splitDocuments(customDocs)
                            docs.push(...splittedDocs)
                        } else {
                            docs.push(...customDocs)
                        }
                    } else {
                        // ใช้ PDFLoader ปกติ
                        await this.extractDocs(usage, bf, legacyBuild, this.textSplitter, docs)
                    }
                }
            }
        } else {
            throw new Error('File upload is required')
        }

        if (metadata) {
            const parsedMetadata = typeof metadata === 'object' ? metadata : JSON.parse(metadata)
            docs = docs.map((doc) => ({
                ...doc,
                metadata: {
                    ...doc.metadata,
                    ...parsedMetadata
                }
            }))
        }

        if (output === 'document') {
            return docs
        } else {
            let finaltext = ''
            for (const doc of docs) {
                finaltext += `${doc.pageContent}\n`
            }
            return handleEscapeCharacters(finaltext, false)
        }
    }

    /**
     * ส่งไฟล์ไปยัง Custom OCR API
     * @param buffer - Buffer ของไฟล์
     * @param filename - ชื่อไฟล์
     * @returns Array of Document objects
     */
    private async postFilesToCustomApi(buffer: Buffer, filename: string): Promise<Document[]> {
        try {
            console.log('[CustomOCR] Starting postFilesToCustomApi')
            console.log('[CustomOCR] API URL:', this.customOcrApiUrl)
            console.log('[CustomOCR] API Key exists:', !!this.customOcrApiKey)
            console.log('[CustomOCR] Filename:', filename)
            console.log('[CustomOCR] Buffer size:', buffer.length)

            // ใช้ node-fetch compatible FormData
            const FormData = require('form-data')
            const formData = new FormData()

            // เพิ่ม Buffer โดยตรงพร้อม filename และ content-type
            formData.append('files', buffer, {
                filename: filename,
                contentType: 'application/pdf'
            })

            // Encode filename สำหรับ header (ป้องกัน UTF-8 characters)
            const encodedFilename = Buffer.from(filename, 'utf-8').toString('base64')

            // กำหนด headers (FormData จะเพิ่ม Content-Type boundary เอง)
            const headers = {
                Authorization: `Bearer ${this.customOcrApiKey}`,
                'X-Filename': encodedFilename,
                ...formData.getHeaders()
            }

            console.log('[CustomOCR] Sending request to:', this.customOcrApiUrl)

            // ส่ง request ไปยัง Custom OCR API โดยใช้ node-fetch
            const fetch = require('node-fetch')
            const response = await fetch(this.customOcrApiUrl!, {
                method: 'POST',
                body: formData,
                headers
            })

            console.log('[CustomOCR] Response status:', response.status)

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Custom OCR API request failed with status ${response.status}: ${errorText}`)
            }

            // รับ response กลับมา (array ของแต่ละหน้า PDF)
            const result = await response.json()

            // API ต้อง return เป็น array ของ text แต่ละหน้า
            if (!Array.isArray(result)) {
                throw new Error('Invalid response format from Custom OCR API: expected array of pages')
            }

            // แปลง result เป็น documents
            return this.extractDocsFromCustomApi(result, filename)
        } catch (error: any) {
            throw new Error(`Failed to process file with Custom OCR API: ${error.message}`)
        }
    }

    /**
     * แปลง response จาก Custom OCR API เป็น Document objects
     * @param result - Array ของ text แต่ละหน้าจาก API
     * @param filename - ชื่อไฟล์
     * @returns Array of Document objects
     */
    private extractDocsFromCustomApi(result: any[], filename: string): Document[] {
        const isPdf = filename.toLowerCase().endsWith('.pdf')
        const documents: Document[] = []

        if (this.usage === 'perFile') {
            // perFile: รวมทุกหน้าเป็น document เดียว
            const pageContent = result
                .map((item, index) => {
                    const content = typeof item === 'string' ? item : item.pageContent || item.text || item.content || ''
                    return index === 0 ? content : `<PAGE_BREAK>${index + 1}</PAGE_BREAK>\n\n${content}`
                })
                .join('\n\n')

            const metadata: any = {
                source: filename,
                custom_ocr: true
            }

            // รวม metadata จากหน้าแรก (ถ้ามี)
            if (typeof result[0] === 'object' && result[0]?.metadata) {
                Object.assign(metadata, result[0].metadata)
            }

            documents.push(new Document({ pageContent, metadata }))
        } else {
            // perPage: แยกเป็น document แต่ละหน้า
            result.forEach((item, index) => {
                const pageContent = typeof item === 'string' ? item : item.pageContent || item.text || item.content || ''
                const metadata: any = {
                    source: filename,
                    custom_ocr: true
                }

                // เพิ่ม metadata จาก item (ถ้ามี)
                if (typeof item === 'object' && item.metadata) {
                    Object.assign(metadata, item.metadata)
                }

                // เพิ่ม loc.pageNumber สำหรับ PDF
                if (isPdf) {
                    metadata.loc = {
                        pageNumber: index + 1
                    }

                    // คำนวณ lines จาก pageContent
                    if (typeof item === 'object' && item.lines) {
                        // ถ้า API ส่งมาให้
                        metadata.loc.lines = item.lines
                    } else if (typeof item === 'object' && item.metadata?.lines) {
                        // ถ้าอยู่ใน metadata
                        metadata.loc.lines = item.metadata.lines
                    } else if (pageContent) {
                        // คำนวณเองจากจำนวนบรรทัดใน text
                        const lineCount = pageContent.split('\n').length
                        metadata.loc.lines = {
                            from: 1,
                            to: lineCount
                        }
                    }
                }

                documents.push(new Document({ pageContent, metadata }))
            })
        }

        return documents
    }

    private async extractDocs(usage: string, bf: Buffer, legacyBuild: boolean, textSplitter: TextSplitter | undefined, docs: IDocument[]) {
        if (usage === 'perFile') {
            const uint8Array = new Uint8Array(bf)
            const loader = new PDFLoader(new Blob([uint8Array]), {
                splitPages: false,
                pdfjs: () =>
                    // @ts-ignore
                    legacyBuild ? import('pdfjs-dist/legacy/build/pdf.js') : import('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')
            })
            if (textSplitter) {
                let splittedDocs = await loader.load()
                splittedDocs = await textSplitter.splitDocuments(splittedDocs)
                docs.push(...splittedDocs)
            } else {
                docs.push(...(await loader.load()))
            }
        } else {
            const uint8Array = new Uint8Array(bf)
            const loader = new PDFLoader(new Blob([uint8Array]), {
                pdfjs: () =>
                    // @ts-ignore
                    legacyBuild ? import('pdfjs-dist/legacy/build/pdf.js') : import('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')
            })
            if (textSplitter) {
                let splittedDocs = await loader.load()
                splittedDocs = await textSplitter.splitDocuments(splittedDocs)
                docs.push(...splittedDocs)
            } else {
                docs.push(...(await loader.load()))
            }
        }
    }
}

module.exports = { nodeClass: CustomOCR_DocumentLoader }
