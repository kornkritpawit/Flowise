import { INodeParams, INodeCredential } from '../src/Interface'

class CustomOcrApi implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]

    constructor() {
        this.label = 'Custom OCR API'
        this.name = 'customOcrApi'
        this.version = 1.0
        this.inputs = [
            {
                label: 'Custom OCR Api Key',
                name: 'customOcrApiKey',
                type: 'password'
            }
        ]
    }
}

module.exports = { credClass: CustomOcrApi }
